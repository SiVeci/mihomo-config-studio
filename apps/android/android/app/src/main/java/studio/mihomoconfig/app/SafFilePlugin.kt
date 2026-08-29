package studio.mihomoconfig.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream

private const val STREAM_BUFFER_SIZE = 8192

/**
 * Product implementation of FR-AND-01/02/03 (open/save via SAF, share via
 * `ACTION_SEND`) — the JS-side contract is `PlatformFileService`
 * (`apps/web/src/platform/capacitor.ts`); `web.ts` implements the same port
 * with browser APIs (ADR-026).
 *
 * Three things this plugin does that the M0-5 spike (`m0spike.SafFilePlugin`)
 * did not (v0.6.0 #3 "实现要点"):
 * 1. Persists the SAF grant (`takePersistableUriPermission`) so the URI
 *    stays usable after the process is killed and restarted, not just for
 *    the activity result that just fired.
 * 2. Treats the user backing out of the system picker as a normal outcome —
 *    `call.resolve(cancelled = true)`, never `call.reject` — the version
 *    document's own "测试要求" names picker cancellation as an
 *    easily-missed failure path that must be tested, not thrown past.
 * 3. Reads/writes through a fixed-size buffer loop instead of one
 *    `InputStream.readBytes()`/`String` round trip, avoiding the extra
 *    full-size buffer copies that pattern forces for a large file.
 *
 * Content crosses the JS bridge as base64, uniformly for text (YAML) and
 * binary (`.mcsproj`, a ZIP) payloads — the bridge only carries JSON, and a
 * `.mcsproj`'s raw bytes are not valid UTF-8, so treating a binary export as
 * text here would silently corrupt it. `capacitor.ts` decodes an opened
 * document's base64 back to UTF-8 text because every `openDocument` caller
 * today only imports YAML (no `.mcsproj` *import* UI exists yet); that is a
 * JS-side choice, not a constraint of this plugin.
 *
 * `writePrivate`/`readPrivate` from the M0-5 spike are deliberately not
 * carried over: ADR-026 settled FR-AND-04 (private storage) on IndexedDB
 * inside the WebView, not a native filesDir round trip — keeping unused
 * native methods around would leave a second, untested private-storage path
 * that nothing calls.
 */
@CapacitorPlugin(name = "SafFile")
class SafFilePlugin : Plugin() {

    private var pendingSaveContentBase64: String = ""

    /**
     * FR-AND-07 (v0.6.0 #13): Capacitor's `Bridge` calls this for every
     * plugin on both cold start (`BridgeActivity.onCreate` → `load()` →
     * `onNewIntent(getIntent())`, the launch intent routed through this same
     * method) and warm start (`MainActivity`'s `singleTask` launch mode
     * means a second share redelivers via `Activity.onNewIntent`, which
     * `BridgeActivity` forwards here too) — no `MainActivity` override
     * needed for either path. `retainUntilConsumed = true` on
     * `notifyListeners` queues the event if the JS side has not called
     * `addListener('incomingDocument', …)` yet (always true on a cold
     * start, since the WebView has not finished booting React at this
     * point) and replays it the moment the first listener attaches.
     */
    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        if (intent.action != Intent.ACTION_SEND) return
        try {
            val streamUri = getStreamExtra(intent)
            val name: String
            val bytes: ByteArray
            if (streamUri != null) {
                bytes = context.contentResolver.openInputStream(streamUri)?.use { readAllBytes(it) } ?: return
                name = queryDisplayName(streamUri) ?: "shared.yaml"
            } else {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
                bytes = text.toByteArray(Charsets.UTF_8)
                name = "shared.yaml"
            }
            val data = JSObject()
            data.put("name", name)
            data.put("contentBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            notifyListeners("incomingDocument", data, true)
        } catch (e: Exception) {
            // No PluginCall to reject here (this is an unsolicited native
            // event, not a JS-initiated call) — a malformed share just
            // means no incomingDocument event fires, same as no share at
            // all, not a crash.
        }
    }

    @Suppress("DEPRECATION")
    private fun getStreamExtra(intent: Intent): Uri? = intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @PluginMethod
    fun openDocument(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(call, intent, "openDocumentResult")
    }

    @ActivityCallback
    private fun openDocumentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            call.resolve(cancelledResult())
            return
        }
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val bytes = context.contentResolver.openInputStream(uri)?.use { readAllBytes(it) } ?: ByteArray(0)
            val ret = JSObject()
            ret.put("cancelled", false)
            ret.put("name", queryDisplayName(uri) ?: "document")
            ret.put("contentBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("open failed")
        }
    }

    @PluginMethod
    fun createDocument(call: PluginCall) {
        val suggestedName = call.getString("suggestedName") ?: "config.yaml"
        pendingSaveContentBase64 = call.getString("contentBase64") ?: ""
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_TITLE, suggestedName)
        }
        startActivityForResult(call, intent, "createDocumentResult")
    }

    @ActivityCallback
    private fun createDocumentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            pendingSaveContentBase64 = ""
            call.resolve(cancelledResult())
            return
        }
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val bytes = Base64.decode(pendingSaveContentBase64, Base64.NO_WRAP)
            context.contentResolver.openOutputStream(uri)?.use { writeAllBytes(it, bytes) }
            val ret = JSObject()
            ret.put("cancelled", false)
            ret.put("name", queryDisplayName(uri) ?: suggestedNameFallback(call))
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("save failed")
        } finally {
            pendingSaveContentBase64 = ""
        }
    }

    /**
     * `ACTION_SEND`'s chooser gives the calling app no reliable callback for
     * "the user backed out without picking a target" — a platform
     * limitation. Cancel/failure distinction on the JS side is v0.6.0 #5's
     * job; today, resolving here only means the chooser was shown.
     */
    @PluginMethod
    fun shareText(call: PluginCall) {
        val contentBase64 = call.getString("contentBase64") ?: ""
        val filename = call.getString("filename") ?: "config.yaml"
        try {
            val bytes = Base64.decode(contentBase64, Base64.NO_WRAP)
            val file = File(context.cacheDir, filename)
            file.outputStream().use { writeAllBytes(it, bytes) }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/octet-stream"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, filename))
            call.resolve()
        } catch (e: Exception) {
            call.reject("share failed")
        }
    }

    private fun cancelledResult(): JSObject {
        val ret = JSObject()
        ret.put("cancelled", true)
        return ret
    }

    private fun suggestedNameFallback(call: PluginCall?): String =
        call?.getString("suggestedName") ?: "document"

    private fun queryDisplayName(uri: Uri): String? {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && cursor.moveToFirst()) {
                return cursor.getString(idx)
            }
        }
        return null
    }

    private fun readAllBytes(input: InputStream): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(STREAM_BUFFER_SIZE)
        var bytesRead: Int
        while (input.read(chunk).also { bytesRead = it } != -1) {
            buffer.write(chunk, 0, bytesRead)
        }
        return buffer.toByteArray()
    }

    private fun writeAllBytes(output: OutputStream, bytes: ByteArray) {
        var offset = 0
        while (offset < bytes.size) {
            val length = minOf(STREAM_BUFFER_SIZE, bytes.size - offset)
            output.write(bytes, offset, length)
            offset += length
        }
    }
}
