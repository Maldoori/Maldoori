"""Create a supported MeshCentral template override; never edit package files."""
import argparse
import json
import shutil
import re
import time
import os
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path('/opt/meshcentral'))
root = parser.parse_args().root
package = root / 'node_modules/meshcentral'
source = package / 'views/default.handlebars'
destination = root / 'meshcentral-web/views/default.handlebars'
marker = '// Maldoori desktop launch hook v2.'
old_marker = '// Maldoori desktop launch hook v1.'
version = json.loads((package / 'package.json').read_text()).get('version')
if version != '1.1.59':
    raise SystemExit('Stopped: this override was reviewed for MeshCentral 1.1.59 only.')
config = json.loads((root / 'meshcentral-data/config.json').read_text())
for domain in config.get('domains', {}).values():
    if any(k.lower() == 'webviewspath' and v for k, v in domain.items()):
        raise SystemExit('Stopped: a domain-specific template override already exists.')
for folder in root.glob('meshcentral-web-*/views'):
    raise SystemExit('Stopped: a domain-specific template directory already exists.')
if destination.is_symlink():
    raise SystemExit('Stopped: the custom template must not be a symbolic link.')
if destination.parent.exists():
    for file in destination.parent.glob('default*.handlebars'):
        if file != destination or not any(m in file.read_text() for m in (marker, old_marker)):
            raise SystemExit('Stopped: an existing custom desktop template needs review.')
if destination.exists() and marker in destination.read_text():
    print('Maldoori launch override is already installed; no changes made.')
    raise SystemExit(0)
template = source.read_text()
if destination.exists():
    previous = destination.read_text()
    restored, count = re.subn(r'<script>\s*// Maldoori desktop launch hook v1\.[\s\S]*?</script>\s*(?=</body>)', '', previous)
    if count != 1 or restored.strip() != template.strip():
        raise SystemExit('Stopped: the existing v1 template has other custom changes; review before replacing it.')
if template.count('</body>') != 1 or 'id=connectbutton1 ' not in template or 'function connectDesktop(' not in template:
    raise SystemExit('Stopped: desktop template structure differs from the reviewed version.')
hook = (Path(__file__).parent / 'meshcentral-autoconnect.js').read_text()
template = template.replace('</body>', '<script>\n' + hook + '\n</script>\n</body>')
destination.parent.mkdir(parents=True, exist_ok=True)
if destination.exists():
    shutil.copy2(destination, destination.with_name('default.handlebars.skybase-backup-' + str(time.time_ns())))
temporary = destination.with_name('.skybase-template-' + str(time.time_ns()))
try:
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, 'w') as f:
        f.write(template)
    os.replace(temporary, destination)
finally:
    temporary.unlink(missing_ok=True)
print('Desktop launch override installed. Original package template is unchanged.')
print('Restart MeshCentral to activate. After upgrades, remove and rebuild this override after compatibility review.')
