package studio.mihomoconfig.m0spike

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * M0-5 spike plugin. Wraps SAF open/create-document, ACTION_SEND share, and
 * private filesDir read/write (FR-AND-01..04) — no broad storage permission.
 */
@CapacitorPlugin(name = "SafFile")
class SafFilePlugin : Plugin() {

    private var pendingSaveContent: String = ""

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
            call.reject("open cancelled")
            return
        }
        try {
            val content =
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    stream.readBytes().toString(Charsets.UTF_8)
                } ?: ""
            val ret = JSObject()
            ret.put("name", queryDisplayName(uri) ?: "document")
            ret.put("content", content)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("open failed")
        }
    }

    @PluginMethod
    fun createDocument(call: PluginCall) {
        val suggestedName = call.getString("suggestedName") ?: "config.yaml"
        pendingSaveContent = call.getString("content") ?: ""
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
            pendingSaveContent = ""
            call.reject("save cancelled")
            return
        }
        try {
            context.contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(pendingSaveContent.toByteArray(Charsets.UTF_8))
            }
            val ret = JSObject()
            ret.put("name", queryDisplayName(uri) ?: suggestedNameFallback(call))
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("save failed")
        } finally {
            pendingSaveContent = ""
        }
    }

    @PluginMethod
    fun shareText(call: PluginCall) {
        val content = call.getString("content") ?: ""
        val filename = call.getString("filename") ?: "config.yaml"
        try {
            val file = File(context.cacheDir, filename)
            file.writeText(content, Charsets.UTF_8)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, filename))
            call.resolve()
        } catch (e: Exception) {
            call.reject("share failed")
        }
    }

    @PluginMethod
    fun writePrivate(call: PluginCall) {
        val filename = call.getString("filename")
        if (filename == null) {
            call.reject("filename required")
            return
        }
        try {
            val file = File(context.filesDir, filename)
            file.writeText(call.getString("content") ?: "", Charsets.UTF_8)
            val ret = JSObject()
            ret.put("path", file.absolutePath)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("private write failed")
        }
    }

    @PluginMethod
    fun readPrivate(call: PluginCall) {
        val filename = call.getString("filename")
        if (filename == null) {
            call.reject("filename required")
            return
        }
        try {
            val file = File(context.filesDir, filename)
            if (!file.exists()) {
                call.reject("file not found")
                return
            }
            val ret = JSObject()
            ret.put("content", file.readText(Charsets.UTF_8))
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("private read failed")
        }
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
}
