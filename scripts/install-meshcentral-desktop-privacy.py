"""Install a version-reviewed custom agent core without editing package files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

MARKER = '// SkyBase desktop privacy guard v2.'
def generate(source, guard):
    edits = [
        ('            MeshServerLogEx(34, null, \"Failed to start remote desktop after local user rejected (\"', '            skybasePrivacyViewRejected(this.ws, e);\n            MeshServerLogEx(34, null, \"Failed to start remote desktop after local user rejected (\"'),
        ('                this.descriptorMetadata = "Remote KVM";', '                skybasePrivacyBegin(this);\n                this.descriptorMetadata = "Remote KVM";'),
        ('    // Success\n    this.ws._consentpromise = null;\n    MeshServerLogEx(30,', '    // Success\n    skybasePrivacyViewApproved(this.ws);\n    this.ws._consentpromise = null;\n    MeshServerLogEx(30,'),
        ('    switch (obj.type) {\n        case \'lock\':', '    if (skybasePrivacyControlData(obj, ws)) return;\n    switch (obj.type) {\n        case \'lock\':'),
    ]
    for old, new in edits:
        if source.count(old) != 1:
            raise ValueError('Agent core differs from the reviewed source; no installation performed.')
        source = source.replace(old, new)
    return source + '\n' + guard + '\n'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/opt/meshcentral'))
    args = parser.parse_args()
    package = args.root / 'node_modules/meshcentral'
    if json.loads((package / 'package.json').read_text()).get('version') != '1.1.59':
        raise SystemExit('Stopped: privacy guard reviewed for MeshCentral 1.1.59 only.')
    data = args.root / 'meshcentral-data'
    source = (package / 'agents/meshcore.js').read_text()
    guard = (Path(__file__).parent / 'meshcentral-desktop-privacy.js').read_text()
    generated = generate(source, guard)
    core = data / 'meshcore.js'
    manifest = data / 'skybase-desktop-privacy.json'
    module_names = ['modules_meshcore', 'modules_meshcore_min']
    if core.exists() or manifest.exists():
        if core.is_symlink() or not core.is_file() or not manifest.is_file():
            raise ValueError('Existing custom core needs review.')
        previous = json.loads(manifest.read_text())
        if previous.get('sha256') != hashlib.sha256(core.read_bytes()).hexdigest() or previous.get('meshcentral') != '1.1.59' or previous.get('version') not in (1, 2):
            raise ValueError('Custom agent core has other changes; refusing to replace it.')
        if core.read_text() == generated:
            print('Two-stage desktop privacy core is already installed; no changes made.')
            return
        if not any(marker in core.read_text() for marker in ('// SkyBase desktop privacy guard v1.', MARKER)):
            raise ValueError('Existing core is not a recognized privacy override.')
        suffix = str(time.time_ns())
        shutil.copy2(core, core.with_name('meshcore.js.skybase-backup-' + suffix))
        shutil.copy2(manifest, manifest.with_name('skybase-desktop-privacy.json.backup-' + suffix))
        temporary = data / ('.skybase-core-' + suffix)
        temporary.write_text(generated)
        os.replace(temporary, core)
        previous.update(version=2, sha256=hashlib.sha256(generated.encode()).hexdigest())
        temporary.write_text(json.dumps(previous))
        os.replace(temporary, manifest)
        print('Privacy core updated to v2 with standard Windows consent; prior core and manifest backed up.')
        print('Restart MeshCentral and allow online agents to reload their core.')
        return
    if (data / 'meshcore.min.js').exists() or any((data / name).exists() for name in module_names):
        raise ValueError('Existing custom agent files need review; no files replaced.')
    stage = data / ('.skybase-privacy-' + str(time.time_ns()))
    stage.mkdir(mode=0o700)
    installed = []
    try:
        for name in module_names:
            if (package / 'agents' / name).is_dir():
                shutil.copytree(package / 'agents' / name, stage / name)
        if not any((stage / name).is_dir() for name in module_names):
            raise ValueError('Agent modules missing; no installation performed.')
        (stage / 'meshcore.js').write_text(generated)
        (stage / 'skybase-desktop-privacy.json').write_text(json.dumps({'version': 2, 'meshcentral': '1.1.59', 'sha256': hashlib.sha256(generated.encode()).hexdigest(), 'modules': [name for name in module_names if (stage / name).is_dir()]}))
        # Modules first, core last: never start MeshCentral while this installer runs.
        for name in module_names + ['skybase-desktop-privacy.json', 'meshcore.js']:
            if (stage / name).exists():
                if (data / name).exists():
                    raise ValueError('Agent files appeared during installation; stopped.')
                os.rename(stage / name, data / name)
                installed.append(data / name)
    except Exception:
        for path in reversed(installed):
            if path.is_dir(): shutil.rmtree(path)
            else: path.unlink()
        raise
    finally:
        shutil.rmtree(stage)
    print('Two-stage consent core installed using MeshCentral supported data-directory overrides.')
    print('Package core unchanged. All agent desktop sessions start view-only and require separate local control approval.')
    print('Restart MeshCentral; allow online agents to reload their core. Test on a spare Windows PC before customer use.')
    print('Keep this override version-reviewed when upgrading MeshCentral.')

if __name__ == '__main__':
    try: main()
    except (ValueError, KeyError, TypeError): raise SystemExit('Stopped: existing or incompatible agent files need review; no secrets printed.')
