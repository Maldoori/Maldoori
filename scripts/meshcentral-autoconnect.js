// Maldoori desktop launch hook v3. Uses the ordinary Connect button once.
(function () {
    var launch = new URL(window.location.href);
    if (launch.searchParams.get('maldooriConnect') !== '1') return;
    var target = launch.searchParams.get('node');
    if (!target) return;
    // Control is enabled only by metadata sent AFTER the agent's local consent.
    if (typeof document.createElement === 'function') {
        var watchedDesktop = null, lastPrivacy = null, inputApproved = false;
        var control = document.createElement('button');
        control.id = 'skybase-request-control'; control.textContent = 'Request Control'; control.disabled = true;
        var status = document.createElement('span'); status.id = 'skybase-control-status'; status.textContent = ' Screen viewing approval required';
        control.onclick = function () {
            if (!desktop || !lastPrivacy || lastPrivacy.phase !== 'view-only' || !lastPrivacy.canRequestControl) return;
            control.disabled = true;
            desktop.sendCtrlMsg(JSON.stringify({ ctrlChannel: '102938', type: 'skybase-request-control' }));
        };
        function applyPrivacy() {
            if (!desktop || !desktop.m) { control.disabled = true; lastPrivacy = null; status.textContent = ' Not connected'; return; }
            var approved = lastPrivacy && lastPrivacy.phase === 'control';
            desktop.m.stopInput = !approved;
            var input = document.getElementById('DeskControl');
            if (input) { input.disabled = !approved; if (!approved) input.checked = false; else if (!inputApproved) input.checked = true; }
            inputApproved = !!approved;
            ['DeskClipboardInButton', 'DeskClipboardOutButton', 'deskkeys', 'DeskWD'].forEach(function (id) { var item = document.getElementById(id); if (item) item.style.visibility = approved ? '' : 'hidden'; });
            control.disabled = !lastPrivacy || lastPrivacy.phase !== 'view-only' || !lastPrivacy.canRequestControl;
            status.textContent = !lastPrivacy ? ' Privacy guard not confirmed: do not proceed until installed' : lastPrivacy.phase === 'control' ? ' Client allowed mouse and keyboard control' : lastPrivacy.phase === 'waiting-control' ? ' Waiting for client to allow control' : ' View only: mouse and keyboard blocked';
        }
        window.setInterval(function () {
            ['connectbutton1rspan', 'connectbutton1hspan'].forEach(function (id) { var item = document.getElementById(id); if (item) item.style.display = 'none'; });
            var connect = document.getElementById('connectbutton1');
            if (connect && !document.getElementById(control.id)) { connect.parentNode.parentNode.appendChild(control); connect.parentNode.parentNode.appendChild(status); }
            if (typeof desktop === 'undefined') return;
            if (desktop !== watchedDesktop) {
                watchedDesktop = desktop; lastPrivacy = null; inputApproved = false;
                if (desktop) {
                    desktop.attemptWebRTC = false;
                    var peer = desktop, oldMetadata = desktop.onMetadataChange;
                    desktop.onMetadataChange = function (metadata) {
                        if (desktop !== peer) return;
                        if (oldMetadata) oldMetadata(metadata);
                        if (metadata && metadata.skybasePrivacy && metadata.skybasePrivacy.version === 1) lastPrivacy = metadata.skybasePrivacy;
                        applyPrivacy();
                    };
                    if (desktop.metadata && desktop.metadata.skybasePrivacy) lastPrivacy = desktop.metadata.skybasePrivacy;
                }
            }
            applyPrivacy();
        }, 250);
    }
    var attempts = 0;
    var timer = window.setInterval(function () {
        if (++attempts > 200) { window.clearInterval(timer); return; }
        if (typeof currentNode === 'undefined' || !currentNode ||
            currentNode._id.split('/').pop() !== target ||
            typeof xxcurrentView === 'undefined' || xxcurrentView !== 11 ||
            typeof meshserver === 'undefined' || !meshserver || meshserver.State !== 2) return;
        if (typeof xxdialogMode !== 'undefined' && xxdialogMode) return;
        if (typeof desktop === 'undefined') return;
        // Native desktop-only layout retains connection/session controls and consent dialogs.
        if (launch.searchParams.get('maldooriDesktop') === '1' &&
            typeof deskToggleFull === 'function' && typeof fullscreen !== 'undefined' && !fullscreen) {
            deskToggleFull({ shiftKey: false });
        }
        if (desktop !== null) { window.clearInterval(timer); return; }
        var button = document.getElementById('connectbutton1');
        if (!button || button.disabled || button.offsetParent === null) return;
        window.clearInterval(timer);
        button.click();
    }, 250);
}());
