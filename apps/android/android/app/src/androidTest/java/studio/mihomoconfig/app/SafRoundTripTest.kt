package studio.mihomoconfig.app

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.UiObjectNotFoundException
import androidx.test.uiautomator.UiScrollable
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
     * Scrolls the long project-detail form into view first — most of this
     * app's buttons are well below the fold on a phone. `UiScrollable`'s own
     * `scrollable(true)` auto-detection is tried first but is not fully
     * trusted alone: this page can have more than one scrollable node (the
     * import textarea is itself one), so a manual swipe-and-recheck loop
     * backs it up rather than assuming the first node `UiScrollable` finds
     * is the outer page. Screens with no scrollable container at all (the
     * project list) just skip both and go straight to the direct find.
     *
     * `isLaidOut` exists because `findObject` alone matches the instant a
     * selector's text/resource-id exists anywhere in the accessibility
     * tree — including this app's own self-built list virtualization's
     * not-yet-laid-out sections, confirmed live (`uiautomator dump` right
     * after pasting+importing) to report a real but degenerate bounds rect
     * (collapsed to the origin, or clipped to zero height at the viewport's
     * bottom edge) while genuinely off-screen. Without this check,
     * `tapText`/`tapResourceId` stopped swiping the moment `findObject`
     * returned non-null, before the page had scrolled at all. This check
     * is confirmed necessary but **not sufficient**: `docs/releases/plans/
     * v0.9.0-android-e2e-evidence.md` records a further, still-unresolved
     * finding from the same investigation — once this in-process
     * `device.swipe()` runs even once, `findObject` stops finding "导出"
     * at all (not just with bad bounds), unlike the same gesture issued
     * externally via `adb shell input swipe`, which reliably scrolls it
     * into view within a few tries. Root cause not yet confirmed.
     */
    private fun UiObject2.isLaidOut(): Boolean = visibleBounds.let { it.width() > 0 && it.height() > 0 }

    private fun tapText(text: String) {
        try {
            UiScrollable(UiSelector().scrollable(true)).scrollIntoView(UiSelector().text(text))
        } catch (_: UiObjectNotFoundException) {
            // No scrollable container on this screen.
        }
        var target = device.findObject(By.text(text))?.takeIf { it.isLaidOut() }
        var remainingSwipes = 12
        while (target == null && remainingSwipes > 0) {
            device.swipe(540, 1600, 540, 400, 20)
            target = device.findObject(By.text(text))?.takeIf { it.isLaidOut() }
            remainingSwipes--
        }
        if (target == null) {
            val deadline = System.currentTimeMillis() + WAIT_MS
            while (target == null && System.currentTimeMillis() < deadline) {
                Thread.sleep(200)
                target = device.findObject(By.text(text))?.takeIf { it.isLaidOut() }
            }
        }
        assertNotNull("'$text' never appeared", target)
        target!!.click()
    }

    private fun waitForText(text: String) {
        assertTrue("'$text' never appeared", device.wait(Until.hasObject(By.text(text)), WAIT_MS))
    }

    /** For form controls specifically — see the class doc comment on why these need `resource-id`, not text, as the selector, and `tapText`'s doc comment on why the swipe loop checks real bounds rather than mere existence. */
    private fun tapResourceId(id: String) {
        try {
            UiScrollable(UiSelector().scrollable(true)).scrollIntoView(UiSelector().resourceId(id))
        } catch (_: UiObjectNotFoundException) {
            // No scrollable container on this screen.
        }
        var target = device.findObject(By.res(id))?.takeIf { it.isLaidOut() }
        var remainingSwipes = 12
        while (target == null && remainingSwipes > 0) {
            device.swipe(540, 1600, 540, 400, 20)
            target = device.findObject(By.res(id))?.takeIf { it.isLaidOut() }
            remainingSwipes--
        }
        if (target == null) {
            val deadline = System.currentTimeMillis() + WAIT_MS
            while (target == null && System.currentTimeMillis() < deadline) {
                Thread.sleep(200)
                target = device.findObject(By.res(id))?.takeIf { it.isLaidOut() }
            }
        }
        assertNotNull("resource-id '$id' never appeared", target)
        target!!.click()
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
        device.pressBack()
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
