package studio.mihomoconfig.app

import android.content.Intent
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.Until
import java.security.MessageDigest
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

private const val PACKAGE_NAME = "studio.mihomoconfig.app"
private const val DOCUMENTSUI_PACKAGE = "com.google.android.documentsui"
private const val DOWNLOADS_DIR = "/storage/emulated/0/Download"
private const val WAIT_MS = 15_000L

private const val SETTLE_POLL_MS = 150L

/** How long to let the accessibility event stream go quiet before trusting a coordinate — see `awaitNodeOnScreen`. */
private const val IDLE_MS = 3_000L

/**
 * v0.9.0 #9 (PRD §13.4 Android line; §13.5 release-blocker #5). **Real
 * UIAutomator, not Espresso**: the SAF file picker
 * (`com.google.android.documentsui`) is a *separate app process* this app
 * has no window access to. Espresso only drives the process under test, so
 * it structurally cannot reach a system picker; UIAutomator operates on the
 * whole device's accessibility tree regardless of which process owns a
 * given window, which is the only way to click inside this app's own
 * WebView *and* the picker that briefly takes the foreground.
 *
 * WebView content is reached the same way: Chromium exposes its rendered
 * DOM through the standard Android accessibility tree, confirmed live
 * (`adb shell uiautomator dump` against a running debug build, before this
 * file was written) — but the two node kinds this app renders expose
 * themselves differently, and both were confirmed by that same live dump
 * rather than assumed:
 * - Buttons/links match by their exact Chinese text, the same string a
 *   sighted user reads (`android.widget.Button`, real `text`).
 * - Form controls (`packages/form-renderer/src/controls.tsx`'s
 *   `<input id={id}>`) come through as `text=""`/`content-desc=""`
 *   (`NAF="true"` — "not accessibility friendly": Chromium does not surface
 *   the associated `<label>` text for these) but with `resource-id`
 *   carrying that same `id`, which is this app's own schema field path
 *   (e.g. `/ipv6`) — a more stable target than the invisible label text
 *   would have been anyway.
 *
 * `SafFilePlugin.kt` is the native side these scenarios drive through the
 * real Web UI, never called directly.
 *
 * **Input YAML goes in via "粘贴 YAML 文本" (`ImportPanel.tsx`'s textarea),
 * never a pre-staged on-device file opened through SAF.** An earlier
 * version of this suite wrote input files to `/storage/emulated/0/Download`
 * with a raw shell redirect first — every one of those files was real on
 * disk immediately (`sha256sum` saw it right away) but consistently
 * invisible in the *open* picker's Downloads listing, through several
 * independently-confirmed-live fix attempts (a `MEDIA_SCANNER_SCAN_FILE`
 * broadcast, polling `content query`, MediaStore's own synchronous `content
 * insert`, force-stopping DocumentsUI for a fresh process, and a fixed
 * settle delay — each one verified working by hand, none of them reliable
 * from this suite's own back-to-back automated timing). Files this suite
 * writes through the real SAF *save* flow (`saveAsInDocumentsUi`) were, by
 * contrast, immediately visible to a subsequent open every time this was
 * checked — the difference is a real SAF write versus a bare filesystem
 * write, not a timing budget this suite was short on. Pasting text sidesteps
 * the open-a-pre-staged-file problem entirely for input; every scenario
 * below still exercises a real SAF *save*, and the round-trip scenario
 * exercises a real SAF *open* too, just of a file this suite created via
 * SAF itself rather than behind its back. Results are still read back via
 * `sha256sum` against the real exported file, exactly mirroring the manual
 * verification `docs/releases/plans/v0.9.0-prereq-evidence.md` (slice #0)
 * already did by hand.
 */
@RunWith(AndroidJUnit4::class)
class SafRoundTripTest {
    private lateinit var device: UiDevice

    /**
     * Every test creates its own "未命名项目" (the fixed default name for a
     * new, untitled project) and later re-selects it by that exact text —
     * a clean install before each test guarantees it is the *only* one in
     * the sidebar, not one of several identically-named leftovers from an
     * earlier test in this run. That clearing is `clearPackageData` +
     * `testOptions.execution 'ANDROIDX_TEST_ORCHESTRATOR'`
     * (`app/build.gradle`) — the Orchestrator, a *separate* process, does
     * it between test methods. It cannot be `pm clear` issued from here:
     * Android hosts instrumented test code in-process with the app under
     * test, always, so a test clearing its own package's data (which force-
     * stops it first) kills its own process mid-test. Confirmed the hard
     * way: `SafRoundTripTest`'s first `@Before`-issued `pm clear` reliably
     * produced "Instrumentation run failed due to Process crashed" on
     * whichever test happened to run first, and `adb logcat` for that run
     * showed `PACKAGE_DATA_CLEARED` and `AndroidRuntime: VM exiting` for
     * this exact package a few dozen milliseconds after the test started.
     */
    @Before
    fun startApp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        restartApp()
    }

    /** Just the launch — `@Before`'s only caller now. An earlier version of this suite also called this after `am kill $PACKAGE_NAME` inside a test, to verify an edit survived a real process kill; every run crashed instead ("Test instrumentation process crashed"), confirming the Orchestrator only changes what happens *between* test methods (`startApp`'s doc comment) — a running test method still shares its process with the app under test the whole time it executes, so a test cannot `am kill` its own target and continue. See `editSurvivesNavigatingAwayAndBackAfterAutosave`'s doc comment for how that scenario is actually covered now. */
    private fun restartApp() {
        device.pressHome()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(PACKAGE_NAME)!!
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        assertTrue(
            "app did not reach the foreground",
            device.wait(Until.hasObject(By.pkg(PACKAGE_NAME).depth(0)), WAIT_MS),
        )
    }

    // ---- device shell helpers ----

    private fun shell(command: String): String =
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
            .let { pfd -> java.io.FileInputStream(pfd.fileDescriptor).use { it.readBytes() } }
            .toString(Charsets.UTF_8)

    private fun sha256OfDeviceFile(path: String): String =
        shell("sha256sum $path").trim().substringBefore(' ')

    private fun sha256Of(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    // ---- WebView (this app's own UI) helpers ----

    /**
     * Everything below locates nodes by walking the live accessibility tree
     * (see [findNode]) and taps real screen coordinates, instead of the
     * `UiScrollable` + swipe-until-found + `UiDevice.findObject` apparatus
     * this suite used through its first four investigation rounds. That
     * apparatus is gone because all three of its parts were measured and
     * found to be either useless or actively harmful here — the full
     * derivation is in `docs/releases/plans/v0.9.0-android-e2e-evidence.md`,
     * the short version:
     *
     * - `UiScrollable(UiSelector().scrollable(true))` could never work: a
     *   live host-side dump shows **no** node on this page is
     *   `scrollable="true"` (Chromium scrolls the document itself without
     *   exposing a scrollable node), so it only ever searched to
     *   `setMaxSearchSwipes` and gave up, at a measured ~87 seconds a call.
     * - The swipe loop was worse than useless: scrolling this WebView by
     *   touch gesture — issued in-process via `UiDevice.swipe()` *or*
     *   externally via `adb shell input swipe`, the two behave identically
     *   — collapses its entire Chromium virtual view hierarchy out of the
     *   accessibility tree as this process sees it (54 nodes carrying real
     *   text before, 8 bare native shell nodes after, never recovering
     *   within the test method), while an external client looking at the
     *   same screen still sees the complete tree.
     * - And none of that scrolling was ever needed: the target was on
     *   screen the whole time. `findObject` simply could not see it.
     */
    private fun rootNode(): AccessibilityNodeInfo? =
        InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow

    /**
     * Depth-first walk of the live accessibility tree, and the reason this
     * suite no longer locates anything inside its own WebView through
     * `UiDevice.findObject`.
     *
     * The two obvious shortcuts do not work here. `AccessibilityNodeInfo`'s
     * own `findAccessibilityNodeInfosByText`/`...ByViewId` are optional for
     * a virtual view hierarchy to implement and Chromium's does not — asked
     * for "导出" against a live tree that demonstrably contained it, they
     * return an empty list. And `UiDevice.findObject`, which does walk,
     * goes selectively blind on this page: logged live, at the exact moment
     * this walk found "导出" sitting at `Rect(63, 1816 - 175, 1887)` —
     * on screen, correct size, ready to tap — `findObject(By.text("导出"))`
     * returned `null` for the same string on the same screen. Smaller
     * screens on the way there (26 and 42 nodes) resolved identically
     * through both; the divergence showed up on the 54-node project page.
     * The likely mechanism is that `findObject` searches the roots handed
     * out by `UiAutomation.getWindows()` while this walk starts from
     * `rootInActiveWindow`, and only the latter is fresh — but that is
     * inference, not something this suite has proved, so treat it as the
     * observation it is: on this page, walk the tree, do not ask
     * `findObject`.
     *
     * This also retires the whole swipe-until-it-appears apparatus that
     * used to live here. "导出" was never actually off-screen and never
     * needed scrolling; the scrolling only ever existed to work around the
     * blind lookup, and it was itself what tore this WebView's
     * accessibility tree down (evidence doc, fourth round).
     */
    private fun findNode(node: AccessibilityNodeInfo?, match: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        if (node == null) return null
        if (match(node)) return node
        for (i in 0 until node.childCount) {
            findNode(node.getChild(i), match)?.let { return it }
        }
        return null
    }

    private fun AccessibilityNodeInfo.screenBounds(): Rect = Rect().also { getBoundsInScreen(it) }

    /** Only for failure messages — a bare "never appeared" on a screen this dense is not enough to debug from. */
    private fun visibleTexts(): List<String> {
        val found = mutableListOf<String>()
        fun walk(node: AccessibilityNodeInfo?) {
            if (node == null) return
            node.text?.toString()?.takeIf { it.isNotBlank() }?.let { found.add(it) }
            for (i in 0 until node.childCount) walk(node.getChild(i))
        }
        walk(rootNode())
        return found
    }

    /**
     * Waits for [desc] to appear, scrolls it into view, and returns the
     * screen rect to tap — but only once Chromium has actually finished
     * laying the page out.
     *
     * That last part is the whole difficulty. Chromium's accessibility
     * bounds lag this page's layout after a re-render, and they lag it
     * *stably*, which defeats a naive "wait until it stops moving" check:
     * measured, after switching to the 表单 tab, `/ipv6` kept reporting the
     * position it held on the previous layout, identically on read after
     * read, and a tap at that centre landed on the 运行模式 `<select>`
     * above it and opened that dropdown (`[rule, global, direct]`) instead.
     * The same lag put "导出" at y=1816 while that band of screen was
     * showing the form's 常规 fieldset.
     *
     * Two things fix it, and both are needed. [UiDevice.waitForIdle] waits
     * out the accessibility event stream, which is what Chromium emits as
     * it relayouts, so reads happen after the dust settles rather than
     * during. And `ACTION_SHOW_ON_SCREEN` — a DOM scroll-into-view, a no-op
     * when the element is already visible — makes Chromium republish real
     * bounds for anything below the fold; it is what turns that stale
     * y=1816 for "导出" into its true y=1199.
     *
     * Clicking the node directly via `ACTION_CLICK` instead of tapping
     * coordinates was tried and does not work here: Chromium reports the
     * node clickable and returns success for the action, but no DOM click
     * is dispatched and the UI does not react at all.
     */
    private fun awaitNodeOnScreen(desc: String, match: (AccessibilityNodeInfo) -> Boolean): Rect {
        val deadline = System.currentTimeMillis() + WAIT_MS
        var lastSeen: Rect? = null
        var settledAt: Rect? = null
        var nudged = false
        while (System.currentTimeMillis() < deadline) {
            device.waitForIdle(IDLE_MS)
            val node = findNode(rootNode(), match)
            if (node == null) {
                settledAt = null
                Thread.sleep(SETTLE_POLL_MS)
                continue
            }
            if (!nudged) {
                nudged = true
                node.performAction(android.R.id.accessibilityActionShowOnScreen)
                device.waitForIdle(IDLE_MS)
                continue
            }
            val bounds = node.screenBounds()
            lastSeen = bounds
            if (bounds.width() > 0 && bounds.height() > 0 && bounds.bottom > 0 && bounds.top < device.displayHeight) {
                if (bounds == settledAt) return bounds
                settledAt = bounds
            } else {
                settledAt = null
                node.performAction(android.R.id.accessibilityActionShowOnScreen)
            }
            Thread.sleep(SETTLE_POLL_MS)
        }
        throw AssertionError("'$desc' never appeared (last seen bounds: $lastSeen; on screen now: ${visibleTexts()})")
    }

    /** A real touch at the target's real centre — the same gesture a user makes. */
    private fun tapNodeAt(bounds: Rect) {
        device.click(bounds.centerX(), bounds.centerY())
        device.waitForIdle(IDLE_MS)
    }

    private fun tapText(text: String) {
        tapNodeAt(awaitNodeOnScreen(text) { it.text?.toString() == text })
    }

    private fun waitForText(text: String) {
        val deadline = System.currentTimeMillis() + WAIT_MS
        while (System.currentTimeMillis() < deadline) {
            if (findNode(rootNode()) { it.text?.toString() == text } != null) return
            Thread.sleep(100)
        }
        throw AssertionError("'$text' never appeared")
    }

    /** For form controls specifically — see the class doc comment on why these need `resource-id`, not text, as the selector. */
    private fun tapResourceId(id: String) {
        tapNodeAt(awaitNodeOnScreen("resource-id '$id'") { it.viewIdResourceName == id })
    }

    /** Input side of every scenario below — see the class doc comment for why this replaces opening a pre-staged on-device file. `ImportPanel.tsx`'s textarea (`id="import-paste"`) has the same label-not-surfaced shape `tapResourceId` already works around. */
    private fun pasteYamlText(yaml: String) {
        val field = device.wait(Until.findObject(By.res("import-paste")), WAIT_MS)
        assertNotNull("import textarea never appeared", field)
        field.text = yaml
        tapText("导入")
        waitForText("导入成功")
    }

    // ---- SAF picker helpers ----

    private fun waitForDocumentsUi() {
        assertTrue(
            "system file picker never appeared",
            device.wait(Until.hasObject(By.pkg(DOCUMENTSUI_PACKAGE).depth(0)), WAIT_MS),
        )
    }

    /** DocumentsUI can default to whatever folder it last showed (state left over from a previous run) — navigating explicitly via the roots drawer keeps this deterministic regardless of prior state. */
    private fun openDownloadsRootInPicker() {
        val drawer = device.findObject(UiSelector().descriptionContains("Show roots"))
        if (drawer.exists()) drawer.click()
        val downloadsRoot = device.wait(Until.findObject(By.text("Downloads")), WAIT_MS)
        assertNotNull("Downloads root never appeared in the picker", downloadsRoot)
        downloadsRoot.click()
    }

    /**
     * Assumes the picker is already open (the caller just clicked
     * "选择文件"). Only ever called in this suite on a file `saveAsInDocumentsUi`
     * itself just wrote through the real SAF save flow — see the class doc
     * comment for why that distinction matters. Still retries by backing
     * out and re-opening a fresh picker instance rather than waiting longer
     * inside the same one, on the general principle that a picker's listing
     * is captured once at open time rather than observed live — cheap
     * insurance, not a fix for a known-flaky wait.
     */
    private fun pickFileInDocumentsUi(fileName: String) {
        val attempts = 3
        repeat(attempts) { attempt ->
            waitForDocumentsUi()
            openDownloadsRootInPicker()
            val item = device.wait(Until.findObject(By.text(fileName)), WAIT_MS / attempts)
            if (item != null) {
                item.click()
                return
            }
            if (attempt < attempts - 1) {
                device.pressBack()
                tapText("选择文件")
            }
        }
        throw AssertionError("'$fileName' never appeared in the picker's Downloads listing after $attempts attempts")
    }

    private fun saveAsInDocumentsUi(fileName: String) {
        waitForDocumentsUi()
        val nameField = device.wait(Until.findObject(By.res("android:id/title").clazz("android.widget.EditText")), WAIT_MS)
        assertNotNull("filename field never appeared in the save dialog", nameField)
        nameField.text = fileName
        val saveButton = device.findObject(By.res("android:id/button1"))
        assertNotNull("SAVE button never appeared", saveButton)
        saveButton.click()
    }

    // ---- scenarios ----

    /**
     * v0.6.0 exit condition #1 ("打开→编辑→另存→重新打开"), chained into
     * one re-runnable flow — "打开" is a real SAF *open*, just of a file
     * this suite wrote through SAF's own *save* moments earlier rather than
     * a pre-staged one (class doc comment explains why). Edit, save, and
     * the byte-for-byte read-back via `sha256sum` are exactly what v0.6.0
     * #8's manual walkthrough did by hand.
     */
    @Test
    fun opensEditsSavesAndReopensRoundTrip() {
        val firstSaveName = "saf-test-first-${UUID.randomUUID()}.yaml"
        val secondSaveName = "saf-test-second-${UUID.randomUUID()}.yaml"
        val inputYaml = "mode: rule\nipv6: false\n"
        val expectedAfterEditYaml = "mode: rule\nipv6: true\n"

        tapText("新建项目")
        pasteYamlText(inputYaml)

        tapText("表单")
        tapResourceId("/ipv6")

        tapText("导出")
        tapText("导出 config.yaml")
        saveAsInDocumentsUi(firstSaveName)
        assertTrue(
            "app did not return to the foreground after saving",
            device.wait(Until.hasObject(By.pkg(PACKAGE_NAME).depth(0)), WAIT_MS),
        )
        assertEquals(
            "exported file bytes must match the edited document exactly",
            sha256Of(expectedAfterEditYaml),
            sha256OfDeviceFile("$DOWNLOADS_DIR/$firstSaveName"),
        )

        // Re-open in a *second*, brand-new project: reading it back inside
        // the same project could just be showing state already held in
        // memory, proving nothing about whether the file was really
        // written and can be read back independently. Verified the same
        // way as the write above — by re-exporting and re-hashing, not by
        // reading UI state back: the raw-editor `<textarea>` has no `id`
        // (only `aria-label`, `editor/YamlEditor.tsx`), so unlike the form
        // controls above it was never confirmed reachable by resource-id on
        // this WebView, and this suite does not assert through a mechanism
        // it has not independently verified.
        // `ExportDialog` deliberately stays open after a save (`handleExportYaml`
        // never calls `onClose` — exporting twice in a row is a supported
        // thing to do), so leaving it is its own explicit step, the same
        // "关闭" a user taps. Backing out of it with `pressBack` instead
        // would spend the back press on the dialog and leave the project
        // page still showing.
        tapText("关闭")
        // `StatusBar`'s own control (PRD §7.3), the only way back to the
        // list on a narrow screen — the sidebar holding the project list is
        // hidden at this width.
        tapText("返回项目列表")
        tapText("新建项目")
        tapText("选择文件")
        pickFileInDocumentsUi(firstSaveName)
        waitForText("导入成功")
        tapText("导出")
        tapText("导出 config.yaml")
        saveAsInDocumentsUi(secondSaveName)
        assertTrue(
            "app did not return to the foreground after re-saving",
            device.wait(Until.hasObject(By.pkg(PACKAGE_NAME).depth(0)), WAIT_MS),
        )
        assertEquals(
            "re-opening and re-exporting the saved file must round-trip byte-for-byte",
            sha256Of(expectedAfterEditYaml),
            sha256OfDeviceFile("$DOWNLOADS_DIR/$secondSaveName"),
        )
    }

    /** SAF's own contract for "the user backed out of the picker": `RESULT_CANCELED`, resolved by `SafFilePlugin.openDocument`'s `cancelledResult()` — never a crash, never a hang. */
    @Test
    fun cancelingThePickerDoesNotCrashTheApp() {
        tapText("新建项目")
        tapText("选择文件")
        waitForDocumentsUi()
        device.pressBack()
        assertTrue(
            "app did not return to the foreground after the picker was cancelled",
            device.wait(Until.hasObject(By.pkg(PACKAGE_NAME).depth(0)), WAIT_MS),
        )
        // Still interactive, not a frozen/crashed window behind the picker.
        tapText("选择文件")
        waitForDocumentsUi()
        device.pressBack()
    }

    /**
     * FR-AND-07-adjacent. **Not a real OS process kill** — that specific
     * case (v0.6.0 #8's manual finding) is structurally impossible to
     * automate as a single self-contained `connectedAndroidTest` method:
     * Android hosts instrumented test code in-process with the app under
     * test for the *entire* time that test method runs, so `am kill
     * $PACKAGE_NAME` from inside a test targeting its own app kills the
     * test right along with it — confirmed empirically (this test used to
     * do exactly that, and every run ended "Test instrumentation process
     * crashed" before a single post-kill assertion could execute). Real
     * process-death survival for this app therefore remains a manually
     * verified fact (v0.6.0 #8, and this slice's own evidence doc), not an
     * automated one — recorded honestly, not silently downgraded.
     *
     * What *is* automatable and still a real, non-trivial assertion: that
     * `StatusBar`'s autosave (`DEFAULT_AUTOSAVE_INTERVAL_MS`, 5s,
     * `packages/storage/src/autosave.ts`) truly reaches IndexedDB rather
     * than only React's in-memory state, by forcing a fresh read of it —
     * navigating away to the project list and back re-mounts `ProjectPage`
     * and re-runs its `resolveProjectSchema`/config-load path from
     * storage, the same as a real cold read. Waiting for "已保存" alone
     * right after the click would risk matching the *pre-edit* idle state
     * still on screen rather than a save this edit actually triggered —
     * waiting for "保存中…" first proves a new save cycle really started.
     * Verified by export + hash, same as the round-trip test above, for
     * the same reason: no UI-state introspection this suite has not
     * independently confirmed reachable.
     */
    @Test
    fun editSurvivesNavigatingAwayAndBackAfterAutosave() {
        val outputName = "saf-autosave-output-${UUID.randomUUID()}.yaml"
        val expectedOutputYaml = "mode: rule\nipv6: true\n"

        tapText("新建项目")
        pasteYamlText("mode: rule\nipv6: false\n")

        tapText("表单")
        tapResourceId("/ipv6")
        waitForText("保存中…")
        waitForText("已保存")

        // Back to the project list (unmounts `ProjectPage`) and into the
        // same project again (a fresh mount, `selectedId` starts `null`
        // and this project has to be re-selected) — the only way, short of
        // a real process kill, to force a read that cannot be answered
        // from a component instance that simply never forgot the edit.
        device.pressBack()
        tapText("未命名项目")
        tapText("导出")
        tapText("导出 config.yaml")
        saveAsInDocumentsUi(outputName)
        assertTrue(
            "app did not return to the foreground after saving",
            device.wait(Until.hasObject(By.pkg(PACKAGE_NAME).depth(0)), WAIT_MS),
        )
        assertEquals(
            "the edit must still be there after a fresh read from storage",
            sha256Of(expectedOutputYaml),
            sha256OfDeviceFile("$DOWNLOADS_DIR/$outputName"),
        )
    }

    /**
     * `ACTION_SEND`'s system chooser is automatable up to the point it
     * appears — completing a share needs a real receiving app, which is
     * outside anything this suite controls (as-designed, not a gap in this
     * test: see this slice's own evidence doc).
     */
    @Test
    fun shareOpensTheSystemChooser() {
        tapText("新建项目")
        pasteYamlText("mode: rule\n")

        tapText("导出")
        tapText("分享")
        tapText("分享 config.yaml")

        // The chooser's own title is whatever `Intent.createChooser`'s
        // second argument was (`SafFilePlugin.shareText`: the filename
        // itself, e.g. "config.yaml") and its list of targets depends on
        // whatever the emulator image happens to have installed — neither
        // is a stable string to assert on. What is stable, regardless of
        // Android version or OEM chooser implementation: this app's own
        // window is no longer what is in front, because something else —
        // the chooser — took over.
        assertTrue(
            "the system share chooser never took the foreground away from this app",
            device.wait(Until.gone(By.pkg(PACKAGE_NAME).depth(0)), WAIT_MS),
        )
    }
}
