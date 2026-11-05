using System;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

internal sealed partial class HostWindow
{
    private bool verifying;
    private readonly System.Diagnostics.Stopwatch startupClock = System.Diagnostics.Stopwatch.StartNew();
    internal bool StartupVerification { get { var args = System.Environment.GetCommandLineArgs(); return args.Length > 6 && args[6] == "startup"; } }
    internal bool PdfVerification { get { var args = System.Environment.GetCommandLineArgs(); return args.Length > 6 && args[6] == "pdf"; } }
    internal bool LayoutVerification { get { var args = System.Environment.GetCommandLineArgs(); return args.Length > 6 && (args[6] == "layout" || args[6] == "failure" || args[6] == "requested-fixes" || args[6].StartsWith("stability")); } }
    private bool FailureVerification { get { var args = System.Environment.GetCommandLineArgs(); return args.Length > 6 && args[6] == "failure"; } }
    private readonly System.Collections.Generic.List<string> recoveryPrompts = new System.Collections.Generic.List<string>();
    private readonly System.Collections.Generic.List<DialogResult> recoveryDecisions = new System.Collections.Generic.List<DialogResult>();
    private readonly System.Collections.Generic.Queue<DialogResult> recoveryAnswers = new System.Collections.Generic.Queue<DialogResult>();
    private DialogResult VerifyRecoveryPrompt(string category, string message, MessageBoxButtons buttons)
    {
        recoveryPrompts.Add(category);
        var answer = recoveryAnswers.Count > 0 ? recoveryAnswers.Dequeue() : DialogResult.Cancel;
        recoveryDecisions.Add(answer);
        return answer;
    }
    private bool LegacyVerification { get { var args = System.Environment.GetCommandLineArgs(); return args.Length > 6 && args[6] == "legacy"; } }

    private async Task VerifyInterface()
    {
        string[] arguments = System.Environment.GetCommandLineArgs();
        if (LegacyVerification)
        {
            if (verifying) return;
            verifying = true;
            for (int i = 0; i < 240; i++)
            {
                string done = await view.CoreWebView2.ExecuteScriptAsync("document.title.includes('QA_READY') || document.getElementById('status')?.textContent.includes('Datos conservados')");
                if (done == "true") {
                    string source = await view.CoreWebView2.ExecuteScriptAsync("document.body.dataset.qaSource || null");
                    if (source != "null") { Directory.CreateDirectory(arguments[5]); File.WriteAllText(Path.Combine(arguments[5],"source-fixture.json"),source); }
                    allowClose = true; Close(); return;
                }
                await Task.Delay(250);
            }
            allowClose = true;
            Close();
            return;
        }
        if (!primary || verifying || arguments.Length < 6 || !view.CoreWebView2.Source.Contains("/BASE.html")) return;
        verifying = true;
        string directory = Path.GetFullPath(arguments[5]);
        Directory.CreateDirectory(directory);
        string previousError = Path.Combine(directory,"error.txt");
        if (File.Exists(previousError)) File.Delete(previousError);
        try
        {
            if (StartupVerification)
            {
                bool startupReady = false;
                const string startupState = @"(() => {
                    const loader = document.getElementById('loader');
                    const recovery = JSON.parse(localStorage.getItem('alioth_native_migration_recovery') || '[]');
                    return {marker:localStorage.getItem('alioth_native_storage_ready'),
                        dbOpen:!!window.app?.db?.isOpen?.(),sseReady:window.app?._tabEventsSource?.readyState === 1,
                        loaderHidden:!!loader && getComputedStyle(loader).display === 'none',
                        splashHidden:!document.getElementById('alioth-splash'),recoveryCount:recovery.length,
                        nullBackupRetained:recovery.some(row=>row.database==='AliothPDFEditor' && row.store==='recents' && row.value.type==='primitive' && row.value.value===null && row.key.type==='primitive' && typeof row.key.value==='number')};
                })()";
                System.Collections.Generic.Dictionary<string, object> state = null;
                for (int i = 0; i < 160; i++)
                {
                    state = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(
                        await view.CoreWebView2.ExecuteScriptAsync(startupState));
                    startupReady = (bool)state["dbOpen"] && (bool)state["sseReady"] && (bool)state["loaderHidden"] && (bool)state["splashHidden"];
                    if (startupReady) break;
                    await Task.Delay(250);
                }
                startupClock.Stop();
                state["ok"] = startupReady;
                state["elapsedMs"] = startupClock.ElapsedMilliseconds;
                if (startupReady) state["session"] = Program.Json.Deserialize<object>(await EvaluatePromise(@"(async()=>({
                    storedDocuments:await app.db.documents.count(),storedSources:await app.db.sources.count(),
                    openTabs:app.docs.length,openDocuments:app.docs.filter(doc=>doc.pages?.length).length,
                    pageCounts:app.docs.map(doc=>doc.pages?.length||0),reading:!!app._readingMode
                }))()"));
                File.WriteAllText(Path.Combine(directory, "startup.json"), Program.Json.Serialize(state));
                await CaptureView(directory, "startup.png");
                if (!startupReady) throw new Exception("STARTUP_NOT_READY");
                allowClose = true;
                Close();
                return;
            }
            bool ready = false;
            for (int i = 0; i < 160; i++)
            {
                ready = await view.CoreWebView2.ExecuteScriptAsync("!!(window.app?.db && document.body.classList.contains('compact-chrome') && document.querySelector('.chrome-window-controls:not([hidden])'))") == "true";
                if (ready) break;
                await Task.Delay(250);
            }
            if (!ready) throw new Exception("INTERFACE_NOT_READY");
            await Task.Delay(600);
            if (LayoutVerification)
            {
                if (arguments[6] == "requested-fixes") await VerifyRequestedFixes(directory);
                else if (arguments[6].StartsWith("stability")) await VerifyStability(directory, arguments[6].EndsWith("resume"));
                else if (FailureVerification) await VerifyFailures(directory);
                else await VerifyLayout(directory);
                return;
            }
            if (arguments.Length > 6 && arguments[6] == "migration")
            {
                string migrated = await EvaluatePromise(@"(async()=>{
                    const row=await app.db.appState.get('qa_migration');
                    const read=async(name,store,key)=>new Promise((resolve,reject)=>{
                        const request=indexedDB.open(name);request.onerror=()=>reject(request.error);
                        request.onsuccess=()=>{const db=request.result,call=db.transaction(store).objectStore(store).get(key);call.onsuccess=()=>{resolve(call.result);db.close();};call.onerror=()=>reject(call.error);};
                    });
                    return {marker:localStorage.getItem('alioth_qa_marker'),reading:document.body.classList.contains('reading-mode'),
                        bytes:Array.from(new Uint8Array(row.buffer)),typed:Array.from(row.typed),date:row.date.toISOString(),
                        blob:await row.blob.text(),nested:row.nested,undef:row.missing===undefined,
                        signature:(await read('AliothFirmasDB','firmas',1)).nombre,conversation:(await read('AliothAI','conversations','qa-conversation')).messages[0].content,unrelated:localStorage.getItem('unrelated_qa_key')};
                })()");
                File.WriteAllText(Path.Combine(directory,"migration.json"), migrated);
            }
            File.WriteAllText(Path.Combine(directory, "initial.json"), await view.CoreWebView2.ExecuteScriptAsync(Snapshot));
            await CaptureView(directory, "initial.png");
            if (arguments.Length > 6 && arguments[6] == "pdf")
            {
                bool loaded = false;
                for (int i = 0; i < 240; i++)
                {
                    loaded = await view.CoreWebView2.ExecuteScriptAsync("app.getDoc()?.pages?.length===2 && app._tabEventsSource?.readyState===1 && !!document.querySelector('#canvas-container canvas[width]')") == "true";
                    if (loaded) break;
                    await Task.Delay(250);
                }
                if (!loaded)
                {
                    File.WriteAllText(Path.Combine(directory,"pdf-status.json"),await view.CoreWebView2.ExecuteScriptAsync("({docs:app.docs.map(d=>({pages:d.pages?.length,name:d.name})),sse:app._tabEventsSource?.readyState,canvases:document.querySelectorAll('canvas').length,loader:document.getElementById('loader')?.innerText,source:location.href})"));
                    await CaptureView(directory,"pdf-failure.png");
                    throw new Exception("PDF_OR_EVENTS_NOT_READY");
                }
                string saved = await EvaluatePromise(@"(async()=>{
                    const doc=app.getDoc(), target=await app.bindOpenedFilePath(doc.id,doc.originalPath);
                    app.rotatePage(90);
                    const result=await app.saveDocument(doc.id,{token:target.token,expectedFingerprint:target.fingerprint});
                    return {pages:doc.pages.length,rotation:doc.pages[doc.currentIndex].rotation,saved:result.status,sse:app._tabEventsSource.readyState};
                })()");
                File.WriteAllText(Path.Combine(directory,"pdf.json"),saved);
                await CaptureView(directory,"pdf.png");
                await view.CoreWebView2.ExecuteScriptAsync("app.detachTabToNewWindow(app.activeDocId)");
                HostWindow child = null;
                for (int i = 0; i < 160; i++)
                {
                    foreach (System.Windows.Forms.Form form in System.Windows.Forms.Application.OpenForms)
                        if (form is HostWindow && form != this) child = (HostWindow)form;
                    if(i==20 && child!=null && child.view.CoreWebView2!=null) File.WriteAllText(Path.Combine(directory,"child-diagnostic.json"),await child.view.CoreWebView2.ExecuteScriptAsync("({native:!!window.__aliothNativeHost,webview:!!window.chrome?.webview,classes:document.body.className,origin:location.origin,controls:document.querySelector('.chrome-window-controls')?.outerHTML})"));
                    if (child != null && child.view.CoreWebView2 != null && await child.view.CoreWebView2.ExecuteScriptAsync("app?.getDoc()?.pages?.length===2 && app._tabEventsSource?.readyState===1 && document.querySelector('.chrome-window-controls')?.hidden===false") == "true") break;
                    await Task.Delay(250);
                }
                if (child == null || await child.view.CoreWebView2.ExecuteScriptAsync("app?.getDoc()?.pages?.length===2 && app._tabEventsSource?.readyState===1 && document.querySelector('.chrome-window-controls')?.hidden===false") != "true")
                {
                    if(child != null) {
                        File.WriteAllText(Path.Combine(directory,"child-diagnostic.json"),await child.view.CoreWebView2.ExecuteScriptAsync("({native:!!window.__aliothNativeHost,webview:!!window.chrome?.webview,classes:document.body.className,origin:location.origin,controls:document.querySelector('.chrome-window-controls')?.outerHTML})"));
                    }
                    throw new Exception("DETACHED_WINDOW_NOT_READY");
                }
                File.WriteAllText(Path.Combine(directory,"detached.json"),await child.view.CoreWebView2.ExecuteScriptAsync("({pages:app.getDoc()?.pages?.length,opener:!!window.opener,sse:app._tabEventsSource?.readyState,titlebars:document.querySelectorAll('.app-titlebar').length,controlsVisible:document.querySelector('.chrome-window-controls')?.hidden===false})"));
                await child.CaptureView(directory,"detached.png");
                File.WriteAllText(Path.Combine(directory,"result.json"),"{\"ok\":true,\"pdf\":true,\"detached\":true}");
                child.Close();
                for (int i=0;i<40 && !child.IsDisposed;i++) await Task.Delay(100);
                if (!child.IsDisposed) throw new Exception("DETACHED_WINDOW_CLOSE_NOT_ACKNOWLEDGED");
                Close();
                return;
            }
            if (arguments.Length > 6 && arguments[6] == "resume")
            {
                File.WriteAllText(Path.Combine(directory, "result.json"), "{\"ok\":true,\"resume\":true}");
                Close();
                return;
            }
            await view.CoreWebView2.ExecuteScriptAsync("if(document.body.classList.contains('reading-mode')) document.getElementById('btn-reading-mode').click()");
            await Task.Delay(300);
            await CaptureView(directory, "normal.png");
            File.WriteAllText(Path.Combine(directory, "normal.json"), await view.CoreWebView2.ExecuteScriptAsync(Snapshot));
            await view.CoreWebView2.ExecuteScriptAsync("document.getElementById('btn-reading-mode').click()");
            await Task.Delay(300);
            await CaptureView(directory, "reading.png");
            File.WriteAllText(Path.Combine(directory, "reading.json"), await view.CoreWebView2.ExecuteScriptAsync(Snapshot));
            await view.CoreWebView2.ExecuteScriptAsync("document.getElementById('toggleAutoScrollReading').click()");
            File.WriteAllText(Path.Combine(directory, "scroll-open.json"), await view.CoreWebView2.ExecuteScriptAsync(Snapshot));
            await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('#autoscroll-widget button').click()");
            File.WriteAllText(Path.Combine(directory, "scroll-closed.json"), await view.CoreWebView2.ExecuteScriptAsync(Snapshot));
            await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-window=\"toggle-maximize\"]').click()");
            await Task.Delay(250);
            bool restored = WindowState == System.Windows.Forms.FormWindowState.Normal;
            await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-window=\"toggle-maximize\"]').click()");
            await Task.Delay(250);
            bool maximized = WindowState == System.Windows.Forms.FormWindowState.Maximized;
            File.WriteAllText(Path.Combine(directory, "result.json"), Program.Json.Serialize(new { ok = true, restored, maximized }));
            Close();
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(directory, "error.txt"), error.ToString());
            var windows = new System.Collections.Generic.List<HostWindow>();
            foreach (System.Windows.Forms.Form form in System.Windows.Forms.Application.OpenForms)
                if (form is HostWindow) windows.Add((HostWindow)form);
            foreach (var window in windows) { window.allowClose = true; window.Close(); }
        }
    }

    private async Task CaptureView(string directory, string name)
    {
        using (var stream = File.Create(Path.Combine(directory, name)))
            await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }

    private async Task<object> ResourceSnapshot()
    {
        var processes = new System.Collections.Generic.List<object>();
        foreach (var info in environment.GetProcessInfos())
        {
            try {
                using (var process = System.Diagnostics.Process.GetProcessById(info.ProcessId))
                    processes.Add(new { id = info.ProcessId, kind = info.Kind.ToString(), cpuSeconds = process.TotalProcessorTime.TotalSeconds, privateBytes = process.PrivateMemorySize64, workingBytes = process.WorkingSet64 });
            } catch (ArgumentException) { }
        }
        return new {
            elapsedMs = startupClock.ElapsedMilliseconds,
            processes,
            heap = Program.Json.Deserialize<object>(await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.getHeapUsage", "{}")),
            caches = Program.Json.Deserialize<object>(await view.CoreWebView2.ExecuteScriptAsync(@"({tabs:app.docs.length,
                thumbnailBytes:app._thumbnailBytes||0,thumbnailEntries:app._thumbnailCache?.size||0,
                closedTabs:app._closedTabsStack?.length||0,closedMemoryBytes:(app._closedTabsStack||[]).reduce((n,item)=>n+(item.buffer?.byteLength||0),0),
                pendingEdits:app._pendingDocumentEdits?.size||0,operationQueues:app._documentOperationQueues?.size||0})"))
        };
    }

    private async Task VerifyStability(string directory, bool resume)
    {
        RequireIsolatedLayoutProfile();
        await WaitForFailureInterface();
        if (System.Environment.GetCommandLineArgs()[6] == "stability-sidebar")
        {
            await VerifySidebarNavigation(directory);
            return;
        }
        if (System.Environment.GetCommandLineArgs()[6].StartsWith("stability-chrome"))
        {
            await Task.Delay(22000);
            await EvaluatePromise(@"(async()=>{
                const pdf=await PDFLib.PDFDocument.create();pdf.addPage([600,800]);
                await app.openFile(new File([await pdf.save()],'QA ribbon.pdf',{type:'application/pdf'}));
                await new Promise(resolve=>setTimeout(resolve,500));
                return true;
            })()");
            File.WriteAllText(Path.Combine(directory,"timeline.json"),await view.CoreWebView2.ExecuteScriptAsync("window.__qaChromeTimeline"));
            string proof=await view.CoreWebView2.ExecuteScriptAsync(@"(()=>{
                const samples=window.__qaChromeTimeline,initial=samples[0].buttons;
                const maxShift=Math.max(...samples.flatMap(s=>s.buttons.map((box,i)=>Math.max(Math.abs(box.x-initial[i].x),Math.abs(box.w-initial[i].w)))));
                return {ok:maxShift<.6 && samples.every(s=>s.classes.includes('compact-chrome')),maxShift,samples:samples.length,openedPdf:app.getDoc().pages.length===1};
            })()");
            File.WriteAllText(Path.Combine(directory,"result.json"),proof);
            if(!(bool)Program.Json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(proof)["ok"])throw new Exception("STARTUP_RIBBON_SHIFT: "+proof);
            Close(); return;
        }
        if (System.Environment.GetCommandLineArgs()[6].StartsWith("stability-ribbon"))
        {
            await VerifyRibbonFonts(directory, System.Environment.GetCommandLineArgs()[6].EndsWith("before"));
            return;
        }
        if (System.Environment.GetCommandLineArgs()[6].StartsWith("stability-session-"))
        {
            await VerifySessionSelection(directory, resume);
            return;
        }
        if (System.Environment.GetCommandLineArgs()[6] == "stability-idle")
        {
            var idle = new System.Collections.Generic.List<object>();
            idle.Add(await ResourceSnapshot());
            await Task.Delay(4000);
            idle.Add(await ResourceSnapshot());
            File.WriteAllText(Path.Combine(directory,"animations.json"),await view.CoreWebView2.ExecuteScriptAsync("document.getAnimations().map(a=>({name:a.animationName,state:a.playState,target:a.effect?.target?.id||a.effect?.target?.className?.baseVal||a.effect?.target?.className}))"));
            await view.CoreWebView2.ExecuteScriptAsync(@"(()=>{const style=document.createElement('style');style.textContent='#ai-floating-btn::before,#ai-floating-btn .ai-face-ring,#ai-floating-btn .ai-face-feature,#ai-floating-btn .ai-eye-dot,#ai-floating-btn .ai-eye-wink,.doc-tab-dirty{animation:none!important}';document.head.appendChild(style);return true;})()");
            await Task.Delay(1000);
            idle.Add(await ResourceSnapshot());
            await Task.Delay(4000);
            idle.Add(await ResourceSnapshot());
            File.WriteAllText(Path.Combine(directory,"idle.json"),Program.Json.Serialize(idle));
            Close(); return;
        }
        if (resume)
        {
            string restored = await EvaluatePromise(@"(async()=>{
                const check=(ok,label)=>{if(!ok)throw Error(label);};
                check(app.docs.length===3,'three restored tabs');
                check(app.getDoc().name==='QA persist 1.pdf','active tab restored');
                check(app.getDoc().pages.length===24,'pages restored');
                check(app.getDoc().pages[0].rotation===90,'rotation restored');
                check(app.getDoc().pages[0].objects.some(o=>o.text==='QA retained'),'annotation restored');
                check(document.body.classList.contains('reading-mode'),'reading preference restored');
                const lazy=app.docs.filter(doc=>doc._sessionSourcesPending);
                check(lazy.length===2,'inactive PDFs stay unloaded');
                await app.hydrateSessionDocument(lazy[0]);
                check(Object.values(lazy[0].sources).some(s=>s.buffer.byteLength>0),'lazy hydration');
                return {ok:true,tabs:app.docs.length,pages:app.getDoc().pages.length,lazyTabs:lazy.length,reading:true};
            })()");
            File.WriteAllText(Path.Combine(directory,"resume.json"),restored);
            File.WriteAllText(Path.Combine(directory,"resources.json"),Program.Json.Serialize(await ResourceSnapshot()));
            Close();
            return;
        }
        await EvaluatePromise(@"(async()=>{
            const pdf=await PDFLib.PDFDocument.create();
            for(let i=0;i<24;i++){const page=pdf.addPage([600,800]);page.drawText('QA stability '+(i+1),{x:50,y:740});}
            window.__qaPdf=await pdf.save();
            return true;
        })()");
        var samples = new System.Collections.Generic.List<object>();
        samples.Add(await ResourceSnapshot());
        for (int round = 0; round < 12; round++)
        {
            await EvaluatePromise(@"(async()=>{
                await app.openFile(new File([window.__qaPdf],'QA cycle.pdf',{type:'application/pdf'}));
                const doc=app.getDoc();
                for(const index of [0,5,12,23])await app.loadPage(index);
                app.closeTab(doc.id,null,true);
                await new Promise(resolve=>setTimeout(resolve,650));
                await Promise.all((app._closedTabsStack||[]).map(item=>item.persisting));
                return true;
            })()");
            if (round == 3 || round == 7 || round == 11)
            {
                await view.CoreWebView2.CallDevToolsProtocolMethodAsync("HeapProfiler.collectGarbage", "{}");
                samples.Add(await ResourceSnapshot());
            }
        }
        string checks = await EvaluatePromise(@"(async()=>{
            const check=(ok,label)=>{if(!ok)throw Error(label);};
            check((app._thumbnailBytes||0)<=16*1024*1024,'thumbnail budget');
            check((app._closedTabsStack||[]).every(item=>!item.buffer),'closed PDF bytes released');
            const closed=app._closedTabsStack.length;
            await app.reopenLastClosedTab();
            check(app.getDoc().pages.length===24,'closed tab reopens from disk');
            if(app.viewMode!=='continuous')app.toggleViewMode();
            await new Promise(resolve=>setTimeout(resolve,600));
            let visited=0;
            for(const index of [0,4,8,12,16,20,23]){
                await app.loadPage(index);
                await new Promise(resolve=>setTimeout(resolve,180));
                visited++;
            }
            await new Promise(resolve=>setTimeout(resolve,600));
            const backgrounds=[...document.querySelectorAll('#mainViewPrimary .bg-page-canvas')];
            const retained=backgrounds.filter(canvas=>canvas.width*canvas.height>0).length;
            check(backgrounds.length===24,'continuous wrappers retained');
            check(retained<=8,'offscreen background pixels released: '+retained);
            if(app.viewMode==='continuous')app.toggleViewMode();
            await new Promise(resolve=>setTimeout(resolve,350));
            app.closeTab(app.activeDocId,null,true);
            await app.releaseClosedTabs();
            for(let i=0;i<3;i++)await app.openFile(new File([window.__qaPdf],'QA persist '+i+'.pdf',{type:'application/pdf'}));
            for(const doc of [...app.docs])if(!doc.pages.length)app.closeTab(doc.id,null,true);
            app.switchTab(app.docs[1].id);
            const doc=app.getDoc();
            await app.setDocumentBaseline(doc.id);
            doc.pages[0].rotation=90;
            doc.pages[0].objects.push({id:'qa-comment',type:'comment',x:50,y:100,text:'QA retained'});
            check(await app.saveSession(),'session checkpoint');
            const before=await app.db.documents.get(doc.id), put=app.db.sources.put;
            const source=Object.values(doc.sources)[0];source.buffer=source.buffer.slice(0);
            doc.name='QA should roll back.pdf';
            app.db.sources.put=async()=>{throw Error('QA injected quota');};
            check(await app.saveSession()===false,'write fails safely');
            app.db.sources.put=put;
            check((await app.db.documents.get(doc.id)).name===before.name,'atomic metadata rollback');
            doc.name=before.name;
            await app.toggleDatabaseEncryption(true,'isolated QA password');
            check(await app.saveSession(),'encrypted binary checkpoint');
            const record=await app.db.documents.get(doc.id);
            check(record._encrypted && typeof record.documentState==='string','baseline metadata encrypted');
            const decrypted=await app.decryptRecord(record,['name','pages','indexEntries','documentState','metadata']);
            check(decrypted.pages[0].rotation===90,'encrypted metadata roundtrip');
            const stored=await app.db.sources.where('docId').equals(doc.id).toArray();
            const bytes=await app.decryptRecord(stored.find(s=>s.kind==='document'),['buffer']);
            check((await PDFLib.PDFDocument.load(bytes.buffer)).getPageCount()===24,'encrypted PDF roundtrip');
            await app.toggleDatabaseEncryption(false);
            check(typeof (await app.db.documents.get(doc.id)).documentState==='object','decrypt baseline metadata');
            if(!document.body.classList.contains('reading-mode'))document.getElementById('btn-reading-mode').click();
            check(await app.saveSession(),'final checkpoint');
            return {ok:true,cycles:12,closedTabsSpilled:closed,continuousPagesVisited:visited,retainedBackgrounds:retained,atomicRollback:true,encryptionRoundtrip:true,tabs:app.docs.length};
        })()");
        samples.Add(await ResourceSnapshot());
        await Task.Delay(3000);
        samples.Add(await ResourceSnapshot());
        File.WriteAllText(Path.Combine(directory,"stability.json"),checks);
        File.WriteAllText(Path.Combine(directory,"resources.json"),Program.Json.Serialize(samples));
        Close();
    }

    private async Task VerifySessionSelection(string directory, bool resume)
    {
        string script = resume ? @"(async()=>{
            const check=(ok,label)=>{if(!ok)throw Error(label);};
            check(app.docs.length===1 && app.docs[0].pages.length===0,'empty session stays empty');
            check(await app.db.documents.get('qa-historical-cache'),'historical cache retained');
            check(!app.docs.some(doc=>doc.id==='qa-historical-cache'),'historical file not reopened');
            const saved=await app.db.appState.get('qa-before-close');
            check((await app.db.documents.get(saved.docId)).pages.length===1,'file was open before close');
            check(document.body.classList.contains('reading-mode'),'reading preference retained');
            return {ok:true,startedWithoutDocuments:true,fileWasOpenBeforeClose:true,readingPreferenceRetained:true,historicalCacheRetained:true,tabs:app.docs.length};
        })()" : @"(async()=>{
            const check=(ok,label)=>{if(!ok)throw Error(label);};
            const pdf=await PDFLib.PDFDocument.create();pdf.addPage([600,800]);
            const buffer=await pdf.save();
            await app.db.documents.put({id:'qa-historical-cache',name:'QA historical.pdf',lastModified:Date.now(),
                pages:[{id:'qa-page',sourceId:'qa-source',pageIndex:0,objects:[]}],currentIndex:0,scale:1});
            await app.db.sources.put({id:'qa-historical-cache_qa-source',docId:'qa-historical-cache',sourceId:'qa-source',
                encoding:'binary-v1',kind:'document',buffer:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)});
            app.docs=[];
            await app.db.appState.delete('session');
            check(await app.restoreSession()===false && app.docs.length===0,'absent session must not guess cached file');
            await app.db.appState.put({key:'session',activeDocId:null,splitView:{mode:'single',
                primary:{docId:'qa-historical-cache'},secondary:{docId:'qa-historical-cache'}}});
            check(await app.restoreSession()===false && app.docs.length===0,'hidden panels must not revive cached file');
            app.createNewTab('QA empty');
            await app.openFile(new File([buffer],'QA left open.pdf',{type:'application/pdf'}));
            if(!document.body.classList.contains('reading-mode'))document.getElementById('btn-reading-mode').click();
            check(app.getDoc().pages.length===1,'file stays open until close');
            check(await app.saveSession(),'save open file');
            await app.db.appState.put({key:'qa-before-close',docId:app.getDoc().id});
            check(await app.db.documents.get('qa-historical-cache'),'cache not deleted');
            return {ok:true,absentSessionIgnoredCache:true,hiddenPanelsIgnored:true,historicalCacheRetained:true,closingWithOpenFile:true};
        })()";
        File.WriteAllText(Path.Combine(directory, "session-selection.json"), await EvaluatePromise(script));
        Close();
    }

    private async Task VerifySidebarNavigation(string directory)
    {
        string result = await EvaluatePromise(@"(async()=>{
            const check=(ok,label)=>{if(!ok)throw Error('SIDEBAR: '+label);};
            const settle=()=>new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),200));
            if(app._readingMode)app.toggleReadingMode();
            if(document.body.classList.contains('h-layout'))app.setHorizontalLayout(false);
            document.getElementById('alioth-legal-welcome')?.style.setProperty('display','none');
            const sidebar=document.getElementById('sidebar'),row=document.getElementById('sidebar-panel-tabs');
            if(sidebar.classList.contains('hidden'))app.toggleSidebar();
            const pdf=await PDFLib.PDFDocument.create();
            for(let i=0;i<19;i++){const page=pdf.addPage([600,800]);page.drawText('QA page '+(i+1),{x:50,y:740});}
            await app.openFile(new File([await pdf.save()],'QA sidebar.pdf',{type:'application/pdf'}));
            await settle();await document.fonts.ready;
            const ids=['toggleSbIndex','toggleSbBookmark','toggleSbAttach','toggleSbFields','toggleSbLayers'];
            const panels=['index-panel-sidebar','bookmark-panel','attach-panel-sidebar','fields-panel-sidebar','layers-panel-sidebar'];
            const counter=document.getElementById('pageCountDisplay'),header=sidebar.querySelector('.sidebar-header-row');
            const snapshots=[];
            for(const width of [100,120,154,240,400])for(const total of [19,99999]){
                sidebar.style.width=width+'px';app.setPageCount('1 / '+total);await settle();
                const buttons=ids.map(id=>document.getElementById(id)),boxes=buttons.map(el=>el.getBoundingClientRect());
                const bounds=sidebar.getBoundingClientRect(),r=row.getBoundingClientRect();
                check(row.children.length===5 && buttons.every(el=>el.parentElement===row),'five horizontal panel buttons');
                check(boxes.every(box=>Math.abs(box.top-boxes[0].top)<.6),'one row');
                check(r.left>=bounds.left-.6 && r.right<=bounds.right+.6,'row within sidebar at '+width);
                check(header.scrollWidth<=header.clientWidth+1 && counter.scrollWidth<=counter.clientWidth+1,'unclipped capsule '+JSON.stringify({width,total,header:[header.clientWidth,header.scrollWidth],counter:[counter.clientWidth,counter.scrollWidth],counterFont:getComputedStyle(counter).fontSize,group:{width:header.lastElementChild.getBoundingClientRect().width,basis:getComputedStyle(header.lastElementChild).flexBasis,gap:getComputedStyle(header.lastElementChild).gap},children:[...header.children].map(el=>({tag:el.tagName,rect:[el.offsetLeft,el.offsetWidth],margin:getComputedStyle(el).margin})),headerClass:header.className,sidebarClass:sidebar.className,buttons:[...header.querySelectorAll('.sidebar-btn-mini')].map(el=>({w:el.getBoundingClientRect().width,min:getComputedStyle(el).minWidth}))}));
                const prefix=counter.querySelector('.page-count-current'),count=counter.querySelector('.page-count-total');
                check(count.textContent===String(total),'complete total');
                if(width<130)check(getComputedStyle(prefix).display==='none','total only when narrow');
                if(width>=154 && total===19)check(getComputedStyle(prefix).display!=='none','current and total when wide');
                for(let i=0;i<buttons.length;i++){
                    const icon=buttons[i].querySelector('svg').getBoundingClientRect(),box=boxes[i];
                    check(icon.left>=box.left-.6 && icon.right<=box.right+.6,'icon contained at '+width);
                }
                snapshots.push({width,total,counterWidth:counter.getBoundingClientRect().width,capsuleWidth:header.getBoundingClientRect().width,totalOnly:getComputedStyle(prefix).display==='none'});
            }
            const normal=snapshots.find(s=>s.width===154 && s.total===19),wide=snapshots.find(s=>s.width===400 && s.total===19);
            check(Math.abs(normal.counterWidth-wide.counterWidth)<.6 && Math.abs(normal.capsuleWidth-wide.capsuleWidth)<.6,'capsule does not stretch');
            check(document.querySelector('#toggleSbAttach svg path').getAttribute('d').startsWith('M21.44'),'paperclip attachments icon');
            sidebar.style.width='154px';app.setPageCount('1 / 19');await settle();
            for(let i=0;i<ids.length;i++){
                const button=document.getElementById(ids[i]);button.click();await settle();
                const panel=document.getElementById(panels[i]);
                check(panel.classList.contains('visible') && button.getAttribute('aria-pressed')==='true','panel action '+ids[i]);
                check(panel.getBoundingClientRect().top>=row.getBoundingClientRect().bottom-.6,'panel below tabs');
                const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
                check(button===hit || button.contains(hit),'panel tabs remain clickable');
                button.click();await settle();
                check(!panel.classList.contains('visible'),'panel closes '+ids[i]);
            }
            app.toggleSidebar();await settle();
            check(ids.every(id=>document.getElementById(id).getBoundingClientRect().width===0),'tabs hidden with sidebar');
            check(document.getElementById('toggleSb').getBoundingClientRect().width>0,'external collapse tab retained');
            app.toggleSidebar();await settle();
            app.setHorizontalLayout(true);await settle();
            check(ids.every(id=>document.getElementById(id).parentElement.id==='sidebarContainer'),'horizontal layout retains its controls');
            app.setHorizontalLayout(false);await settle();
            check(ids.every(id=>document.getElementById(id).parentElement===row),'horizontal controls return to row');
            app.toggleReadingMode();await settle();
            check(row.getBoundingClientRect().width===0,'reading hides the sidebar row');
            app.toggleReadingMode();await settle();
            app.toggleSidebarGrid();await settle();
            check(row.getBoundingClientRect().width===0,'fullscreen grid hides row');
            app.toggleSidebarGrid();await settle();
            return {ok:true,snapshots,allFivePanels:true,attachmentsPaperclip:true,collapse:true,horizontal:true,reading:true,grid:true};
        })()");
        File.WriteAllText(Path.Combine(directory,"sidebar.json"),result);
        foreach (int width in new int[] {100,154,400})
        {
            await view.CoreWebView2.ExecuteScriptAsync("document.getElementById('sidebar').style.width='"+width+"px';app.setPageCount('1 / 19');");
            await Task.Delay(350);
            await CaptureView(directory,"sidebar-"+width+".png");
        }
        File.WriteAllText(Path.Combine(directory,"result.json"),"{\"ok\":true}");
        Close();
    }

    private const string ChromeTimelineScript = @"(()=>{
        const samples=[];window.__qaChromeTimeline=samples;
        const rect=id=>{const el=document.getElementById(id);if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,w:r.width,h:r.height,font:s.fontFamily,display:s.display};};
        const sample=()=>{
            const home=document.getElementById('toolbar-home');if(!home)return;
            const buttons=[...home.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,w:r.width,font:s.fontFamily,text:el.textContent.trim()};});
            const state={home:rect('toolbar-home'),reading:rect('btn-reading-mode'),readingContainer:rect('reading-mode-float-widget'),zoom:rect('zoom-float-widget'),ai:rect('ai-floating-btn'),close:rect('btn-header-close'),save:rect('btn-header-save'),buttons,
                fonts:document.fonts.status,systemRules:document.getElementById('system-fonts-dynamic')?.sheet?.cssRules.length||0,classes:document.body.className};
            const signature=JSON.stringify(state);if(samples.length && samples[samples.length-1].signature===signature)return;
            samples.push({ms:performance.now(),signature,...state});
        };
        document.addEventListener('DOMContentLoaded',()=>{sample();const timer=setInterval(sample,250);setTimeout(()=>clearInterval(timer),30000);});
    })();";

    private async Task VerifyRibbonFonts(string directory, bool beforeFix)
    {
        string result = await EvaluatePromise(@"(async()=>{
            if(document.body.classList.contains('reading-mode'))document.getElementById('btn-reading-mode').click();
            await document.fonts.ready;
            const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            await frame();
            const read=()=>[...document.querySelectorAll('#toolbar-home .tool-btn')].filter(button=>button.getBoundingClientRect().width>0)
                .map(button=>{const rect=button.getBoundingClientRect(),style=getComputedStyle(button);return {x:rect.x,width:rect.width,height:rect.height,font:style.fontFamily};});
            const initial=read();
            const measure=()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='12px Arial';return ctx.measureText('Seleccionar Texto Guardar Documento').width;};
            const originalTextWidth=measure();
            for(const [file,weight] of [['ARIALN.TTF','400'],['ARIALNB.TTF','700']]){
                const bytes=await (await fetch('/fonts/standard_fonts/'+file)).arrayBuffer();
                const face=new FontFace('Arial',bytes,{weight});
                await face.load();document.fonts.add(face);
            }
            await document.fonts.load('12px Arial');await frame();
            const after=read();
            const maxShift=Math.max(...initial.map((box,index)=>Math.max(Math.abs(box.x-after[index].x),Math.abs(box.width-after[index].width))));
            const controls=[...document.querySelectorAll('.header-right > .header-btn')].filter(button=>button.getBoundingClientRect().width>0);
            const gaps=controls.slice(1).map((button,index)=>button.getBoundingClientRect().left-controls[index].getBoundingClientRect().right);
            return {maxShift,initial,after,gaps,originalTextWidth,changedTextWidth:measure(),fontOverrideEffective:Math.abs(originalTextWidth-measure())>1};
        })()");
        File.WriteAllText(Path.Combine(directory,"ribbon-fonts.json"),result);
        var proof=Program.Json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(result);
        if (!(bool)proof["fontOverrideEffective"]) throw new Exception("FONT_OVERRIDE_NOT_EXERCISED");
        double shift=Convert.ToDouble(proof["maxShift"]);
        if (beforeFix ? shift < 1 : shift > 0.6) throw new Exception("RIBBON_FONT_STABILITY: " + result);
        File.WriteAllText(Path.Combine(directory,"result.json"),Program.Json.Serialize(new {ok=true,beforeFix,maxShift=shift}));
        Close();
    }

    private void RequireIsolatedLayoutProfile()
    {
        string root = Path.GetFullPath(Program.Assets).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string profile = Path.GetFullPath(Program.Profile);
        if (!profile.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
            !profile.Substring(root.Length).StartsWith("_qa_", StringComparison.OrdinalIgnoreCase))
            throw new Exception("LAYOUT_REQUIRES_ISOLATED_QA_PROFILE");
    }

    private async Task WaitForFailureInterface()
    {
        for (int i = 0; i < 160; i++)
        {
            try
            {
                if (!rendererUnavailable && await view.CoreWebView2.ExecuteScriptAsync("!!(app.db?.isOpen?.() && app._tabEventsSource?.readyState===1 && !document.getElementById('alioth-splash'))") == "true") return;
            }
            catch { }
            await Task.Delay(100);
        }
        throw new Exception("FAILURE_INTERFACE_NOT_READY");
    }

    private async Task VerifyRequestedFixes(string directory)
    {
        RequireIsolatedLayoutProfile();
        await WaitForFailureInterface();
        string original = Path.Combine(directory, "origen ñ", "base.pdf");
        string inserted = Path.Combine(directory, "insertado", "otro.pdf");
        await view.CoreWebView2.ExecuteScriptAsync(@"(() => {
            document.querySelector('#alioth-legal-welcome [data-local]')?.click();
            window.__qaUnsavedProbe='keep';
            const input=document.createElement('input'); input.type='file'; input.id='qa-native-file';
            input.style.display='none'; document.body.appendChild(input);
        })()");
        var dom = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.getDocument", "{}"));
        var root = (System.Collections.Generic.Dictionary<string, object>)dom["root"];
        var node = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.querySelector", Program.Json.Serialize(new {
                nodeId = root["nodeId"], selector = "#qa-native-file"
            })));
        await view.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.setFileInputFiles", Program.Json.Serialize(new {
            nodeId = node["nodeId"], files = new[] { original }
        }));
        // Use a real disk-backed DOM File and dispatch the same capture event as a drop.
        string opened = await EvaluatePromise(@"(async()=>{
            const file=document.getElementById('qa-native-file').files[0];
            await file._aliothOriginPromise;
            delete file._aliothOriginPromise; delete file._aliothSourcePath;
            const transfer=new DataTransfer(); transfer.items.add(file);
            window.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer}));
            const origin=await app.resolveFileOriginPath(file);
            await app.openFile(file);
            return {origin,documentOrigin:app.getDoc().originalPath,bound:app._nativeSaveTargets.has(app.activeDocId)};
        })()");
        var result = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(opened);
        if ((string)result["origin"] != original || (string)result["documentOrigin"] != original || !(bool)result["bound"])
            throw new Exception("NATIVE_DROP_ORIGIN_FAILED: " + opened);
        await EvaluatePromise(@"(async()=>{
            const response=await fetch('/open-file?path='+encodeURIComponent(" + Program.Json.Serialize(inserted) + @"));
            if(!response.ok)throw Error('FIXTURE_READ_FAILED');
            const file=new File([await response.arrayBuffer()],'otro.pdf',{type:'application/pdf'});
            file._aliothSourcePath=" + Program.Json.Serialize(inserted) + @";
            await app.insertPDF(file);
            await app.saveFromHeader('save');
            return true;
        })()");
        string saved = await EvaluatePromise(@"(async()=>{
            let requested;
            const realFetch=window.fetch;
            window.fetch=async(url,options)=>{
                if(url==='/api/files/pick-save'){
                    requested=JSON.parse(options.body);
                    return {ok:true,json:async()=>({ok:true,cancelled:true})};
                }
                return realFetch(url,options);
            };
            try { await app.pickSaveTarget('editado.pdf'); } finally { window.fetch=realFetch; }
            return {original:app.getDoc().originalPath,pages:app.getDoc().pages.length,
                savedRevision:app.getDoc().documentState.savedRevision,requested,
                green:getComputedStyle(document.querySelector('#btn-header-save-as svg')).color,
                fontBuffers:Object.keys(app._systemFontBytes||{}).length};
        })()");
        var savedResult = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(saved);
        var requested = (System.Collections.Generic.Dictionary<string, object>)savedResult["requested"];
        if ((string)savedResult["original"] != original || Convert.ToInt32(savedResult["pages"]) != 2 ||
            (string)requested["source_path"] != original || (string)savedResult["green"] != "rgb(74, 222, 128)")
            throw new Exception("INSERT_SAVE_ORIGIN_FAILED: " + saved);
        int promptsBefore = recoveryPrompts.Count;
        var busy = view.CoreWebView2.ExecuteScriptAsync("{const end=performance.now()+17000;while(performance.now()<end){};}");
        CheckRendererResponse(view.CoreWebView2);
        await busy;
        await Task.Delay(600);
        if (recoveryPrompts.Count != promptsBefore || rendererUnavailable || rendererProbePending ||
            recoveryBar != null && recoveryBar.Visible ||
            await view.CoreWebView2.ExecuteScriptAsync("window.__qaUnsavedProbe") != "\"keep\"")
            throw new Exception("TEMPORARY_BUSY_DISCARDED_STATE_OR_PROMPTED");
        await CaptureView(directory, "requested-fixes.png");
        File.WriteAllText(Path.Combine(directory,"requested-fixes.json"), Program.Json.Serialize(new {
            ok = true, nativeDrop = result, insertionAndSave = savedResult,
            busyRecoveredWithoutReload = true, unsavedMemoryRetained = true, modalPrompts = recoveryPrompts.Count
        }));
        allowClose = true;
        Close();
    }

    private async Task VerifyFailures(string directory)
    {
        RequireIsolatedLayoutProfile();
        await WaitForFailureInterface();
        view.CoreWebView2.Navigate(Program.Origin + "/__qa_missing_document_404");
        for (int i = 0; i < 100 && !recoveryPrompts.Contains("navigation"); i++) await Task.Delay(100);
        if (!recoveryPrompts.Contains("navigation") || recoveryBar == null || !recoveryBar.Visible)
            throw new Exception("HTTP_FAILURE_RECOVERY_NOT_AVAILABLE");
        await Task.Delay(400);
        if (!view.CoreWebView2.Source.EndsWith("/__qa_missing_document_404")) throw new Exception("UNREQUESTED_NAVIGATION_RELOAD");
        view.CoreWebView2.Navigate(Program.Origin + "/BASE.html");
        await WaitForFailureInterface();
        await view.CoreWebView2.ExecuteScriptAsync("localStorage.setItem('alioth_qa_recovery_probe','retained');window.__qaUnsavedProbe='in-memory'");
        var crashing = view.CoreWebView2.CallDevToolsProtocolMethodAsync("Page.crash", "{}");
        crashing.ContinueWith(task => { var observed = task.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
        for (int i = 0; i < 100 && !recoveryPrompts.Contains("renderer"); i++) await Task.Delay(100);
        if (!rendererUnavailable || !recoveryPrompts.Contains("renderer") || recoveryBar == null || !recoveryBar.Visible)
            throw new Exception("RENDERER_CRASH_RECOVERY_NOT_AVAILABLE");
        await Task.Delay(400);
        if (!rendererUnavailable || !recoveryBar.Visible) throw new Exception("UNREQUESTED_RENDERER_RELOAD");
        int beforeClose = recoveryPrompts.Count;
        Close();
        for (int i = 0; i < 50 && recoveryPrompts.Count == beforeClose; i++) await Task.Delay(100);
        if (IsDisposed || preparingClose || !recoveryPrompts.Contains("close-timeout")) throw new Exception("CRASH_CLOSE_CANCEL_FAILED");
        recoveryAnswers.Enqueue(DialogResult.Retry);
        OfferRecovery();
        await Task.Delay(100);
        await WaitForFailureInterface();
        string retained = await view.CoreWebView2.ExecuteScriptAsync("({saved:localStorage.getItem('alioth_qa_recovery_probe'),memory:window.__qaUnsavedProbe||null})");
        var retainedState = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(retained);
        if ((string)retainedState["saved"] != "retained" || retainedState["memory"] != null || recoveryBar.Visible)
            throw new Exception("EXPLICIT_RENDERER_RECOVERY_FAILED");
        int browserProcessId = (int)view.CoreWebView2.BrowserProcessId;
        if (browserProcessId == System.Diagnostics.Process.GetCurrentProcess().Id) throw new Exception("INVALID_QA_BROWSER_PROCESS");
        using (var browserProcess = System.Diagnostics.Process.GetProcessById(browserProcessId)) browserProcess.Kill();
        for (int i = 0; i < 100 && !recoveryPrompts.Contains("browser"); i++) await Task.Delay(100);
        if (!rendererUnavailable || !recreateNeeded || !recoveryPrompts.Contains("browser") || !recoveryBar.Visible)
            throw new Exception("BROWSER_CRASH_RECOVERY_NOT_AVAILABLE");
        await Task.Delay(400);
        if (!rendererUnavailable || !recreateNeeded) throw new Exception("UNREQUESTED_BROWSER_RECREATE");
        recoveryAnswers.Enqueue(DialogResult.Retry);
        OfferRecovery();
        await Task.Delay(100);
        await WaitForFailureInterface();
        if (await view.CoreWebView2.ExecuteScriptAsync("localStorage.getItem('alioth_qa_recovery_probe')") != "\"retained\"" || recoveryBar.Visible)
            throw new Exception("EXPLICIT_BROWSER_RECOVERY_FAILED");
        await view.CoreWebView2.ExecuteScriptAsync("app.flushDocumentEdits=()=>new Promise(()=>{})");
        closeTimer.Interval = 200;
        beforeClose = recoveryPrompts.Count;
        recoveryAnswers.Enqueue(DialogResult.Yes);
        recoveryAnswers.Enqueue(DialogResult.Cancel);
        Close();
        int pendingPrompts = recoveryPrompts.Count;
        OfferRecovery();
        await RetryRecovery();
        if (!preparingClose || recoveryPrompts.Count != pendingPrompts) throw new Exception("RETRY_INTERFERED_WITH_PENDING_CLOSE");
        for (int i = 0; i < 50 && recoveryPrompts.Count < beforeClose + 2; i++) await Task.Delay(100);
        if (IsDisposed || preparingClose || recoveryPrompts.Count < beforeClose + 2 || !recoveryDecisions.Contains(DialogResult.Yes))
            throw new Exception("CLOSE_WAIT_AND_CANCEL_FAILED");
        await CaptureView(directory, "recovered.png");
        recoveryAnswers.Enqueue(DialogResult.No);
        preparingClose = true;
        closeId = Guid.NewGuid().ToString("N");
        CloseTimedOut(null, EventArgs.Empty);
        if (!IsDisposed) throw new Exception("EXPLICIT_FORCE_CLOSE_FAILED");
        File.WriteAllText(Path.Combine(directory, "failure-result.json"), Program.Json.Serialize(new {
            ok = true, httpFailure = true, actualRendererCrash = true, actualBrowserCrash = true, noAutomaticReload = true,
            explicitRetry = true, savedStorageRetained = true, closeWait = true, closeCancel = true,
            explicitForceClose = true, retryBlockedDuringClose = true, prompts = recoveryPrompts, decisions = recoveryDecisions
        }));
    }

    private async Task VerifyLayout(string directory)
    {
        RequireIsolatedLayoutProfile();
        bool loaded = false;
        for (int i = 0; i < 160; i++)
        {
            loaded = await view.CoreWebView2.ExecuteScriptAsync("!!(app.db?.isOpen?.() && app._tabEventsSource?.readyState===1 && !document.getElementById('alioth-splash'))") == "true";
            if (loaded) break;
            await Task.Delay(250);
        }
        if (!loaded) throw new Exception("LAYOUT_INTERFACE_NOT_LOADED");
        await view.CoreWebView2.ExecuteScriptAsync("document.getElementById('alioth-legal-welcome')?.style.setProperty('display','none');");
        await view.CoreWebView2.ExecuteScriptAsync("if(document.body.classList.contains('reading-mode')) document.getElementById('btn-reading-mode').click()");
        await Task.Delay(350);
        await VerifyChromeAppearance(directory);
        await SetLayoutWindowState(false);
        await CaptureLayout(directory, "layout-normal-restored", null);
        await SetLayoutWindowState(true);
        await CaptureLayout(directory, "layout-normal-maximized", null);
        await DragLayoutDock(true);
        await CaptureLayout(directory, "layout-normal-drag-top", "top");
        await DragLayoutDock(false);
        await CaptureLayout(directory, "layout-normal-drag-bottom", "bottom");
        await view.CoreWebView2.ExecuteScriptAsync("document.getElementById('btn-reading-mode').click()");
        await Task.Delay(350);
        await CaptureLayout(directory, "layout-reading-maximized", null);
        await DragLayoutDock(true);
        await CaptureLayout(directory, "layout-reading-drag-top", "top");
        await DragLayoutDock(false);
        await CaptureLayout(directory, "layout-reading-drag-bottom", "bottom");
        await SetLayoutWindowState(false);
        await CaptureLayout(directory, "layout-reading-restored", null);
        int tabSnapshots = await VerifyTabNavigation(directory);
        File.WriteAllText(Path.Combine(directory, "result.json"), Program.Json.Serialize(new {
            ok = true, layout = true, layoutSnapshots = 8, tabNavigationSnapshots = tabSnapshots,
            snapshots = 8 + tabSnapshots, fixtureTabs = 26
        }));
        allowClose = true;
        Close();
    }

    private async Task VerifyChromeAppearance(string directory)
    {
        string result=await EvaluatePromise(@"(async()=>{
            const check=(ok,label)=>{if(!ok)throw Error('CHROME_APPEARANCE: '+label);};
            const button=document.getElementById('ai-floating-btn'),original=localStorage.getItem('alioth_last_preset')||'original';
            const dark=document.body.classList.contains('dark-mode'),themes=[];
            for(const mode of [false,true])for(const name of ['original','obsidian']){
                document.body.classList.toggle('dark-mode',mode);app.applyThemePreset(name,true);
                await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                const style=getComputedStyle(button),header=getComputedStyle(document.querySelector('.app-header'));
                const before=getComputedStyle(button,'::before');
                check(style.backgroundImage==='none' && style.animationName==='none','no animated background');
                check(before.content==='none' || before.content==='normal','no aurora overlay');
                check(style.backgroundColor===header.backgroundColor && style.color===header.color,'matches header colors');
                check(getComputedStyle(button.querySelector('.ai-face-ring')).stroke===style.color,'visible smile ring');
                check([...button.querySelectorAll('.ai-face-feature')].every(el=>getComputedStyle(el).stroke===style.color),'visible face features');
                themes.push({name,dark:mode,background:style.backgroundColor,color:style.color});
            }
            check(new Set(themes.map(theme=>theme.background)).size>1,'button follows theme changes');
            document.body.classList.toggle('dark-mode',dark);app.applyThemePreset(original,true);
            const animations=button.getAnimations({subtree:true});
            check(animations.every(a=>a.effect.target.matches('.ai-eye-dot,.ai-eye-wink')),'only the eye animates');
            if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
                check(animations.length===2,'wink animations exist');
                for(const animation of animations){animation.pause();animation.currentTime=7600;}
                check(getComputedStyle(button.querySelector('.ai-eye-wink')).opacity==='1' && getComputedStyle(button.querySelector('.ai-eye-dot')).opacity==='0','wink visible');
                for(const animation of animations){animation.currentTime=0;animation.play();}
            }
            button.click();check(document.getElementById('ai-panel').classList.contains('visible'),'AI opens');
            app.toggleAIPanel();check(!document.getElementById('ai-panel').classList.contains('visible'),'AI closes');
            await new Promise(resolve=>setTimeout(resolve,350));
            await document.fonts.ready;
            const ctx=document.createElement('canvas').getContext('2d');
            const measure=font=>{ctx.font='12px '+font;return ctx.measureText('Seleccionar Texto Guardar Documento').width;};
            const compact=measure('""Alioth Ribbon UI""'),standard=measure('Arial');
            check([...document.fonts].some(face=>face.family==='Alioth Ribbon UI' && face.status==='loaded'),'bundled ribbon font loaded');
            check(compact<standard*.9,'compact text metrics');
            return {ok:true,themes,onlyEyeAnimation:true,opensAndCloses:true,ribbonWidths:{compact,standard}};
        })()");
        File.WriteAllText(Path.Combine(directory,"appearance.json"),result);
    }

    private async Task SetLayoutWindowState(bool maximized)
    {
        if ((WindowState == System.Windows.Forms.FormWindowState.Maximized) != maximized)
            await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-window=\"toggle-maximize\"]').click()");
        for (int i = 0; i < 30; i++)
        {
            bool nativeMatches = (WindowState == System.Windows.Forms.FormWindowState.Maximized) == maximized;
            bool iconMatches = await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-window=\"toggle-maximize\"]').classList.contains('is-maximized')") == (maximized ? "true" : "false");
            if (nativeMatches && iconMatches) { await Task.Delay(250); return; }
            await Task.Delay(100);
        }
        throw new Exception("LAYOUT_WINDOW_STATE_NOT_SYNCHRONIZED");
    }

    private async Task DragLayoutDock(bool top)
    {
        string destination = top ? "-10000" : "10000";
        await EvaluatePromise(@"(async()=>{
            const btn=document.getElementById('ai-floating-btn'),r=btn.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
            btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,clientX:x,clientY:y}));
            document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:x,clientY:" + destination + @"}));
            document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,buttons:0,clientX:x,clientY:" + destination + @"}));
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            if(Math.abs(btn.getBoundingClientRect().top-r.top)>.6)throw new Error('AI_DOCK_MOVED_BY_DRAG');
            return true;
        })()");
        await Task.Delay(100);
    }

    private async Task CaptureLayout(string directory, string name, string clamp)
    {
        string json = await view.CoreWebView2.ExecuteScriptAsync("(window.__qaLayoutClamp=" + Program.Json.Serialize(clamp) + "," + LayoutSnapshot + ")");
        File.WriteAllText(Path.Combine(directory, name + ".json"), json);
        await CaptureView(directory, name + ".png");
        var state = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(json);
        if (!(bool)state["ok"]) throw new Exception("LAYOUT_ASSERTIONS_FAILED: " + json);
        if ((bool)state["maximized"] != (WindowState == System.Windows.Forms.FormWindowState.Maximized))
            throw new Exception("LAYOUT_NATIVE_STATE_MISMATCH: " + json);
    }

    private async Task<int> VerifyTabNavigation(string directory)
    {
        RequireIsolatedLayoutProfile();
        await view.CoreWebView2.ExecuteScriptAsync("if(document.body.classList.contains('reading-mode')) document.getElementById('btn-reading-mode').click()");
        await Task.Delay(350);
        await SetLayoutWindowState(true);
        await EvaluatePromise(@"(async()=>{
            const ids=[];
            for(let i=0;i<26;i++)ids.push(app.createNewTab('QA documento de navegación '+String(i+1).padStart(2,'0')+'.pdf'));
            window.__qaTabIds=ids;
            await new Promise(resolve=>setTimeout(resolve,700));
            return {created:ids.length,total:app.docs.length};
        })()");
        await EvaluatePromise(TabNavigationHelpers);
        int snapshots = 0;
        await EvaluatePromise("(async()=>{const q=window.__qaTabs;app.switchTab(app.docs[0].id);await new Promise(resolve=>requestAnimationFrame(resolve));q.viewport.scrollTo({left:0,behavior:'instant'});await q.settle();return true;})()");
        await CaptureTabNavigation(directory, "tabs-normal-start", "start"); snapshots++;
        string navigation = await EvaluatePromise(@"(async()=>{
            const q=window.__qaTabs,active=app.activeDocId,start=q.viewport.scrollLeft;
            q.next.click();await q.settle();
            q.assert(q.viewport.scrollLeft>start+1,'right arrow increases scrollLeft');
            q.assert(app.activeDocId===active,'right arrow preserves active document');
            let rightClicks=1;
            while(!q.next.disabled && rightClicks<60){q.next.click();rightClicks++;await q.settle();q.assert(app.activeDocId===active,'right scrolling preserves active document');}
            q.assert(q.next.disabled && !q.previous.disabled,'end arrow states');
            q.assert(Math.abs(q.viewport.scrollWidth-q.viewport.clientWidth-q.viewport.scrollLeft)<=1.5,'reaches end');
            return {rightClicks,activeUnchanged:app.activeDocId===active};
        })()");
        File.WriteAllText(Path.Combine(directory, "tabs-scroll-right.json"), navigation);
        await CaptureTabNavigation(directory, "tabs-normal-end", "end"); snapshots++;
        navigation = await EvaluatePromise(@"(async()=>{
            const q=window.__qaTabs,active=app.activeDocId;let leftClicks=0;
            while(!q.previous.disabled && leftClicks<60){q.previous.click();leftClicks++;await q.settle();q.assert(app.activeDocId===active,'left scrolling preserves active document');}
            q.assert(q.previous.disabled && !q.next.disabled,'start arrow states');
            q.assert(q.viewport.scrollLeft<=1.5,'reaches start');
            const last=window.__qaTabIds.at(-1),tab=[...q.viewport.querySelectorAll('.doc-tab')][app.docs.findIndex(doc=>doc.id===last)];
            q.assert(tab.getBoundingClientRect().left>=q.viewport.getBoundingClientRect().right,'activation target initially outside viewport');
            app.switchTab(last);await new Promise(resolve=>requestAnimationFrame(resolve));await q.settle();
            q.assert(app.activeDocId===last,'outside tab becomes active');q.assert(q.activeVisible(),'active tab automatically becomes visible');
            return {leftClicks,activeVisible:q.activeVisible(),activeChanged:app.activeDocId===last};
        })()");
        File.WriteAllText(Path.Combine(directory, "tabs-scroll-left-and-activate.json"), navigation);
        await CaptureTabNavigation(directory, "tabs-normal-active-visible", "active"); snapshots++;
        navigation = await EvaluatePromise(@"(async()=>{
            const q=window.__qaTabs,moved=window.__qaTabIds.at(-1),first=q.viewport.querySelector('.doc-tab'),r=first.getBoundingClientRect(),active=app.activeDocId;
            const transfer=new DataTransfer();transfer.setData('text/doc-tab-id',moved);
            first.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:r.left+1,clientY:r.top+r.height/2}));
            first.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:r.left+1,clientY:r.top+r.height/2}));
            await new Promise(resolve=>requestAnimationFrame(resolve));await q.settle();
            q.assert(app.docs[0].id===moved,'local tab reorder updates document order');
            q.assert(app.activeDocId===active,'reorder preserves active document');
            const count=app.docs.length,removed=window.__qaTabIds[3];
            app.closeTab(removed,null,true);await new Promise(resolve=>requestAnimationFrame(resolve));await q.settle();
            q.assert(app.docs.length===count-1 && !app.docs.some(doc=>doc.id===removed),'closing a fixture tab removes exactly one document');
            q.assert(app.activeDocId===active,'closing an inactive tab preserves active document');
            q.assert(q.viewport.querySelectorAll('.doc-tab:not(.doc-tab-add)').length===app.docs.length,'tab DOM follows document count');
            return {reordered:true,closed:true,activeUnchanged:app.activeDocId===active,documents:app.docs.length};
        })()");
        File.WriteAllText(Path.Combine(directory, "tabs-reorder-and-close.json"), navigation);
        await CaptureTabNavigation(directory, "tabs-normal-reordered", "active"); snapshots++;
        await view.CoreWebView2.ExecuteScriptAsync("document.getElementById('btn-reading-mode').click()");
        await Task.Delay(350);
        await CaptureTabNavigation(directory, "tabs-reading-maximized", "active"); snapshots++;
        await SetLayoutWindowState(false);
        await EvaluatePromise("(async()=>{await window.__qaTabs.settle();return true;})()");
        await CaptureTabNavigation(directory, "tabs-reading-restored", "active"); snapshots++;
        await view.CoreWebView2.ExecuteScriptAsync("document.getElementById('btn-reading-mode').click()");
        await Task.Delay(350);
        await CaptureTabNavigation(directory, "tabs-normal-restored", "active"); snapshots++;
        return snapshots;
    }

    private async Task CaptureTabNavigation(string directory, string name, string expectation)
    {
        string json = await view.CoreWebView2.ExecuteScriptAsync("(window.__qaTabExpectation=" + Program.Json.Serialize(expectation) + "," + TabNavigationSnapshot + ")");
        File.WriteAllText(Path.Combine(directory, name + ".json"), json);
        await CaptureView(directory, name + ".png");
        var state = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(json);
        if (!(bool)state["ok"]) throw new Exception("TAB_LAYOUT_ASSERTIONS_FAILED: " + json);
    }

    private async Task<string> EvaluatePromise(string expression)
    {
        string result = await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", Program.Json.Serialize(new { expression, awaitPromise = true, returnByValue = true }));
        var envelope = Program.Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(result);
        if (envelope.ContainsKey("exceptionDetails")) throw new Exception(result);
        var value = (System.Collections.Generic.Dictionary<string, object>)envelope["result"];
        return Program.Json.Serialize(value["value"]);
    }

    private const string Snapshot = @"(() => {
        const ids = ['docTabsWrapper','view-toggle-widget','toolbar-reading','toggleAutoScrollReading','autoscroll-widget','btn-reading-mode','zoom-float-widget','toggleSb','toggleSbIndex','ai-nav-btn-bottom'];
        const read = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,display:style.display,visibility:style.visibility,background:style.backgroundColor,pressed:element.getAttribute('aria-pressed')};
        };
        return {origin:location.origin,secure:isSecureContext,reading:document.body.classList.contains('reading-mode'),
            titlebars:document.querySelectorAll('.app-titlebar').length,controls:read(document.querySelector('.chrome-window-controls')),
            header:read(document.querySelector('.app-header')),titlebar:read(document.querySelector('.app-titlebar')),
            tab:read(document.querySelector('.doc-tab.active')),elements:Object.fromEntries(ids.map(id=>[id,read(document.getElementById(id))]))};
    })()";

    private const string LayoutSnapshot = @"(() => {
        const issues=[],assert=(condition,message)=>{if(!condition)issues.push(message);};
        const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const visible=id=>{
            const e=document.getElementById(id);if(!e)return null;
            const s=getComputedStyle(e),r=rect(e);
            return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0 ? r:null;
        };
        const center=r=>({x:r.left+r.width/2,y:r.top+r.height/2});
        const reading=document.body.classList.contains('reading-mode');
        const buttons=[...document.querySelectorAll('.chrome-window-controls button')];
        assert(buttons.length===3,'three window controls');
        const controls=buttons.map(button=>{
            const svg=button.querySelector('svg'),b=rect(button);
            if(!svg){assert(false,'missing SVG '+button.dataset.window);return {action:button.dataset.window,button:b};}
            const s=rect(svg),style=getComputedStyle(svg),bc=center(b),sc=center(s);
            assert(Math.abs(parseFloat(style.width)-14)<.01 && Math.abs(parseFloat(style.height)-14)<.01,'14px SVG '+button.dataset.window);
            assert(Math.abs(bc.x-sc.x)<.6 && Math.abs(bc.y-sc.y)<.6,'centered SVG '+button.dataset.window);
            assert(style.transform==='none' && style.filter==='none','undistorted SVG '+button.dataset.window);
            return {action:button.dataset.window,button:b,svg:s,width:style.width,height:style.height,centerDelta:{x:sc.x-bc.x,y:sc.y-bc.y}};
        });
        const max=document.querySelector('[data-window=toggle-maximize]'),maximized=max.classList.contains('is-maximized');
        const maximizeGlyph=getComputedStyle(max.querySelector('.chrome-maximize-glyph')).display!=='none';
        const restoreGlyph=getComputedStyle(max.querySelector('.chrome-restore-glyph')).display!=='none';
        assert(maximizeGlyph===!maximized && restoreGlyph===maximized,'max/restore glyph');
        assert(max.getAttribute('aria-label')===(maximized?'Restaurar':'Maximizar'),'max/restore label');
        const widget=document.getElementById('view-toggle-widget'),widgetStyle=getComputedStyle(widget),toggles=visible('view-toggle-widget');
        assert(widgetStyle.backdropFilter==='none','toggle backdrop filter');
        assert(reading ? toggles===null : toggles!==null,'reading toggle visibility');
        const ai=visible('ai-floating-btn'),top=visible('ai-nav-btn-top'),bottom=visible('ai-nav-btn-bottom'),ribbon=visible('ribbonContainer');
        assert(!!ai && !!top && !!bottom && !!ribbon,'dock elements visible');
        const overlap=(a,b)=>a && b && a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
        const horizontal=(a,b)=>a && b && a.left<b.right && a.right>b.left;
        const upper=Math.max(ribbon?.bottom||0,horizontal(ai,toggles)?toggles.bottom:0);
        const obstacles=['reading-mode-float-widget','zoom-float-widget'].map(visible).filter(r=>horizontal(ai,r) && r.top>upper);
        const lower=Math.min(innerHeight,...obstacles.map(r=>r.top));
        if(ai && top && bottom){
            assert(!overlap(top,toggles),'top arrow overlaps toggles');
            assert(top.top>=upper+3.5,'top arrow below ribbon/toggles');
            assert(bottom.bottom<=lower-3.5,'bottom arrow before reading/zoom');
            assert(Math.abs(center(top).x-center(ai).x)<.6 && Math.abs(center(bottom).x-center(ai).x)<.6,'arrows centered on AI');
            assert(ai.top-top.bottom>=3.5 && bottom.top-ai.bottom>=3.5,'arrow vertical gaps');
            const min=upper+top.height+8,max=Math.max(min,lower-ai.height-bottom.height-8);
            const fixedTop=Math.max(min,Math.min(max,(innerHeight-ai.height)/2));
            assert(Math.abs(ai.top-fixedTop)<.6,'AI fixed vertical center');
            assert(Math.abs(ai.width-28.05)<.1 && Math.abs(ai.height-45)<.1,'AI reduced dimensions');
        }
        const readButton=visible('btn-reading-mode'),zoom=visible('zoom-float-widget');
        assert(readButton && zoom && Math.abs(readButton.left-zoom.left)<.6 && Math.abs(readButton.right-zoom.right)<.6,'reading button matches zoom edges');
        const zoomStyle=getComputedStyle(document.getElementById('zoom-float-widget'));
        const zoomControls=visible('zoom-controls-col'),zoomSlider=visible('zoom-slider-col');
        assert(zoomStyle.backgroundColor==='rgba(0, 0, 0, 0)' && parseFloat(zoomStyle.paddingLeft)===0 && parseFloat(zoomStyle.borderLeftWidth)===0 && zoomStyle.boxShadow==='none','no outer zoom panel');
        assert(readButton && zoomControls && zoomSlider && Math.abs(readButton.left-zoomControls.left)<.6 && Math.abs(readButton.right-zoomSlider.right)<.6,'reading matches visible zoom columns');
        const close=visible('btn-header-close'),save=visible('btn-header-save');
        assert(close && save && Math.abs(close.height-save.height)<.1,'close matches file button height');
        assert(!document.getElementById('ai-panel')?.classList.contains('visible'),'AI panel remains closed');
        return {ok:issues.length===0,issues,reading,maximized,maximizeGlyph,restoreGlyph,controls,
            widget:{display:widgetStyle.display,backdropFilter:widgetStyle.backdropFilter,rect:rect(widget)},
            dock:{ai,top,bottom,ribbon,toggles,obstacles,upper,lower,clamp:window.__qaLayoutClamp}};
    })()";

    private const string TabNavigationHelpers = @"(async()=>{
        const viewport=document.getElementById('docTabsWrapper'),strip=viewport.closest('.chrome-tab-strip');
        const arrows=[...strip.querySelectorAll('.chrome-tab-nav')];
        const previous=arrows.find(button=>button.dataset.direction==='-1'),next=arrows.find(button=>button.dataset.direction==='1');
        const assert=(condition,message)=>{if(!condition)throw new Error('TAB_NAVIGATION: '+message);};
        const settle=async()=>{
            let previousPosition=viewport.scrollLeft,stable=0;
            for(let i=0;i<50;i++){
                await new Promise(resolve=>setTimeout(resolve,60));
                const current=viewport.scrollLeft;
                stable=Math.abs(current-previousPosition)<.2?stable+1:0;previousPosition=current;
                if(stable>=3){await new Promise(resolve=>requestAnimationFrame(resolve));return;}
            }
            throw new Error('TAB_NAVIGATION: scrolling did not settle');
        };
        const activeVisible=()=>{
            const tab=viewport.querySelector('.doc-tab.active');if(!tab)return false;
            const t=tab.getBoundingClientRect(),v=viewport.getBoundingClientRect();
            return t.left>=v.left-.6 && t.right<=v.right+.6;
        };
        window.__qaTabs={viewport,strip,previous,next,assert,settle,activeVisible};
        assert(viewport.scrollWidth>viewport.clientWidth+50,'fixture creates horizontal overflow');
        return true;
    })()";

    private const string TabNavigationSnapshot = @"(() => {
        const q=window.__qaTabs,issues=[],assert=(condition,message)=>{if(!condition)issues.push(message);};
        const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const viewport=rect(q.viewport),previous=rect(q.previous),next=rect(q.next);
        const shown=element=>getComputedStyle(element).display!=='none' && element.getBoundingClientRect().width>0;
        assert(shown(q.previous) && shown(q.next),'both tab arrows visible');
        assert(previous.right<=viewport.left+.6 && next.left>=viewport.right-.6,'arrows flank tab viewport');
        assert(viewport.width>0 && q.viewport.scrollWidth>q.viewport.clientWidth,'tab viewport overflows');
        assert(q.previous.disabled===(q.viewport.scrollLeft<=1),'previous enablement matches scroll position');
        assert(q.next.disabled===(q.viewport.scrollLeft>=q.viewport.scrollWidth-q.viewport.clientWidth-1),'next enablement matches scroll position');
        if(window.__qaTabExpectation==='start')assert(q.previous.disabled && !q.next.disabled,'start enables only next arrow');
        if(window.__qaTabExpectation==='end')assert(!q.previous.disabled && q.next.disabled,'end enables only previous arrow');
        if(window.__qaTabExpectation==='active')assert(q.activeVisible(),'active tab remains visible');
        const reading=document.body.classList.contains('reading-mode'),header=document.querySelector('.header-right'),headerStyle=getComputedStyle(header),expectedSize=reading?19:22;
        assert(Math.abs(parseFloat(headerStyle.columnGap)-14)<.01,'header controls use 14px gap');
        const headerButtons=[...header.querySelectorAll(':scope > .header-btn')].filter(shown);
        const gaps=headerButtons.slice(1).map((button,index)=>rect(button).left-rect(headerButtons[index]).right);
        assert(gaps.length===4 && gaps.every(gap=>Math.abs(gap-14)<.6),'all five header controls use 14px gaps');
        const files=[...header.querySelectorAll('.chrome-file-button')].map(button=>{
            const box=rect(button),svg=rect(button.querySelector('svg'));
            assert(Math.abs(box.width-expectedSize)<.6 && Math.abs(box.height-expectedSize)<.6,'file button size '+button.id);
            assert(svg.left>=box.left-.3 && svg.top>=box.top-.3 && svg.right<=box.right+.3 && svg.bottom<=box.bottom+.3,'file icon fits '+button.id);
            return {id:button.id,box,svg};
        });
        assert(files.length===4,'four file controls');
        assert(!document.getElementById('ai-panel')?.classList.contains('visible'),'AI remains closed');
        return {ok:issues.length===0,issues,reading,expectation:window.__qaTabExpectation,
            tabCount:q.viewport.querySelectorAll('.doc-tab').length,documentCount:app.docs.length,
            viewport,previous:{...previous,disabled:q.previous.disabled},next:{...next,disabled:q.next.disabled},
            scrollLeft:q.viewport.scrollLeft,scrollWidth:q.viewport.scrollWidth,clientWidth:q.viewport.clientWidth,
            activeVisible:q.activeVisible(),header:{gap:headerStyle.columnGap,actualGaps:gaps,files}};
    })()";
}
