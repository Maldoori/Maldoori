// SkyBase desktop privacy guard v2. Agent-side view/control approvals.
function skybasePrivacyMetadata(ws, phase) {
    if (!ws || !ws.skybasePrivacy || ws.skybasePrivacy.closed) return;
    ws.skybasePrivacy.phase = phase;
    try { ws.write(JSON.stringify({ ctrlChannel: '102938', type: 'metadata', users: tunnelUserCount.desktop || {}, skybasePrivacy: { version: 1, phase: phase, canRequestControl: ws.skybasePrivacy.canControl, error: ws.skybasePrivacy.error || null } })); } catch (ex) { }
}
function skybasePrivacyBegin(ws) {
    var request = ws.httprequest;
    var rights = request.rights;
    ws.skybasePrivacy = { phase: 'waiting-view', control: false, pending: false, closed: false, canControl: request.desktopviewonly !== true && (rights == 0xFFFFFFFF || ((rights & MESHRIGHT_REMOTECONTROL) != 0 && (rights & MESHRIGHT_REMOTEVIEW) == 0)) };
    request.desktopviewonly = true;
    request.consent = (request.consent || 0) | 73;
    request.consentAutoAccept = request.consentAutoAcceptIfNoUser = request.consentAutoAcceptIfDesktopNoUser = request.consentAutoAcceptIfLocked = request.consentAutoAcceptIfDesktopLocked = false;
    request.oldStyle = false; // Use MeshCentral's standard enhanced Windows consent dialog.
    // Begin resets the consent bit after native cached-approval processing; control asks independently.
    request.consentTimeout = 60;
    request.autolock = false;
    if (request.xoptions) request.xoptions.autolock = false;
    request.soptions = request.soptions || {};
    request.soptions.consentTitle = 'SkyBase IT Solutions - Screen viewing';
    request.soptions.consentMsgDesktop = '{0} requests permission to VIEW your screen. Mouse and keyboard control will remain blocked until you separately allow control. Allow screen viewing?';
    ws.on('end', function () {
        ws.skybasePrivacy.closed = true;
        if (ws.skybasePrivacy.prompt && typeof ws.skybasePrivacy.prompt.close == 'function') { try { ws.skybasePrivacy.prompt.close(); } catch (ex) { } }
    });
}
function skybasePrivacyViewApproved(ws) {
    if (ws && ws.skybasePrivacy) skybasePrivacyMetadata(ws, 'view-only');
}
function skybasePrivacyRequestControl(ws) {
    var guard = ws.skybasePrivacy;
    if (!guard || guard.closed || guard.control || guard.pending || guard.phase !== 'view-only' || !guard.canControl) return;
    guard.pending = true;
    skybasePrivacyMetadata(ws, 'waiting-control');
    var promise;
    try {
        var title = 'SkyBase IT Solutions - Desktop control';
        var message = ws.httprequest.realname + ' requests permission to CONTROL your mouse and keyboard. Allow desktop control for this session?';
        var nativeDialog = null;
        if (typeof process != 'undefined' && process.platform === 'win32') {
            try { nativeDialog = require('win-userconsent'); } catch (missingModule) { }
        }
        if (nativeDialog) {
            promise = nativeDialog.create(title, message, ws.httprequest.realname, { uid: ws.tsid, timeout: 60000, timeoutAutoAccept: false, translations: { Allow: 'Allow', Deny: 'Deny', Auto: 'Approval applies to this session only', Caption: message } });
        } else {
            promise = require('message-box').create(title, message, 60, null, ws.tsid);
        }
        guard.prompt = promise;
        promise.then(function () {
            if (guard.closed || !guard.pending || !ws.httprequest || !ws.httprequest.desktop || !ws.httprequest.desktop.kvm) return;
            guard.pending = false;
            guard.prompt = null;
            try {
                // This is the only new input pipe; it is attached after LOCAL approval.
                ws.pipe(ws.httprequest.desktop.kvm, { dataTypeSkip: 1, end: false });
                guard.control = true;
                ws.httprequest.desktopviewonly = false;
                skybasePrivacyMetadata(ws, 'control');
                MeshServerLogEx(30, null, 'SkyBase desktop control approved by local user', ws.httprequest);
            } catch (ex) {
                try { ws.unpipe(ws.httprequest.desktop.kvm); } catch (ignore) { }
                guard.control = false; ws.httprequest.desktopviewonly = true;
                skybasePrivacyMetadata(ws, 'view-only');
            }
        }, function () {
            guard.pending = false;
            guard.prompt = null;
            if (!guard.closed) skybasePrivacyMetadata(ws, 'view-only');
        });
    } catch (ex) {
        guard.pending = false;
        skybasePrivacyMetadata(ws, 'view-only');
    }
}
function skybasePrivacyControlData(obj, ws) {
    if (!ws || !ws.skybasePrivacy || !obj) return false;
    if (obj.type === 'skybase-request-control') { skybasePrivacyRequestControl(ws); return true; }
    // Keep this guarded connection on WebSocket: no alternative WebRTC input pipe.
    if (['offer', 'webrtc0', 'webrtc1', 'webrtc2'].indexOf(obj.type) >= 0) return true;
    if (!ws.skybasePrivacy.control && ['rtt', 'ping', 'pong', 'close'].indexOf(obj.type) < 0) return true;
    return false;
}

function skybasePrivacyViewRejected(ws, reason) {
    if (!ws || !ws.skybasePrivacy) return;
    var text = String(reason);
    ws.skybasePrivacy.error = /denied|^7$/i.test(text) ? 'The client declined screen viewing.' : /timeout/i.test(text) ? 'Screen viewing request timed out.' : /session|permission|child exited|dispatch/i.test(text) ? 'Windows could not display the approval dialog. Confirm a signed-in, unlocked client session.' : 'Windows did not grant screen viewing. Check the client screen and agent.';
    skybasePrivacyMetadata(ws, 'view-denied');
}
