"""Create a supported MeshCentral template override; never edit package files."""
import json
import os
from pathlib import Path

root = Path('/opt/meshcentral')
package = root / 'node_modules/meshcentral'
source = package / 'views/default.handlebars'
destination = root / 'meshcentral-web/views/default.handlebars'
marker = '// Maldoori desktop launch hook v1.'
version = json.loads((package / 'package.json').read_text()).get('version')
if version != '1.1.59':
    raise SystemExit('Stopped: this override was reviewed for MeshCentral 1.1.59 only.')
config = json.loads((root / 'meshcentral-data/config.json').read_text())
for domain in config.get('domains', {}).values():
    if any(k.lower() == 'webviewspath' and v for k, v in domain.items()):
        raise SystemExit('Stopped: a domain-specific template override already exists.')
for folder in root.glob('meshcentral-web-*/views'):
    raise SystemExit('Stopped: a domain-specific template directory already exists.')
if destination.parent.exists():
    for file in destination.parent.glob('default*.handlebars'):
        if file != destination or marker not in file.read_text():
            raise SystemExit('Stopped: an existing custom desktop template needs review.')
if destination.exists():
    print('Maldoori launch override is already installed; no changes made.')
    raise SystemExit(0)
template = source.read_text()
if template.count('</body>') != 1 or 'id=connectbutton1 ' not in template or 'function connectDesktop(' not in template:
    raise SystemExit('Stopped: desktop template structure differs from the reviewed version.')
hook = (Path(__file__).parent / 'meshcentral-autoconnect.js').read_text()
template = template.replace('</body>', '<script>\n' + hook + '\n</script>\n</body>')
destination.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
with os.fdopen(fd, 'w') as f:
    f.write(template)
print('Desktop launch override installed. Original package template is unchanged.')
print('Restart MeshCentral to activate. After upgrades, remove and rebuild this override after compatibility review.')
