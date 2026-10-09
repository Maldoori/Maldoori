// Maldoori desktop launch hook v1. Uses the ordinary Connect button once.
(function () {
    var launch = new URL(window.location.href);
    if (launch.searchParams.get('maldooriConnect') !== '1') return;
    var target = launch.searchParams.get('node');
    if (!target) return;
    var attempts = 0;
    var timer = window.setInterval(function () {
        if (++attempts > 200) { window.clearInterval(timer); return; }
        if (typeof currentNode === 'undefined' || !currentNode ||
            currentNode._id.split('/').pop() !== target ||
            typeof xxcurrentView === 'undefined' || xxcurrentView !== 11 ||
            typeof meshserver === 'undefined' || !meshserver || meshserver.State !== 2) return;
        if (typeof xxdialogMode !== 'undefined' && xxdialogMode) return;
        if (typeof desktop === 'undefined') return;
        if (desktop !== null) { window.clearInterval(timer); return; }
        var button = document.getElementById('connectbutton1');
        if (!button || button.disabled || button.offsetParent === null) return;
        window.clearInterval(timer);
        button.click();
    }, 250);
}());
