#!/usr/bin/env python3
"""Save Acronis API credentials without exposing values to shell history or output."""
import getpass
import json
import os
from pathlib import Path
import stat
import tempfile
import urllib.parse

file = Path('/etc/maldoori/credentials.json')
metadata = file.lstat()
if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
    raise SystemExit('Credentials must be a regular owner-only file (chmod 600).')
config = json.loads(file.read_text())
url = input('Acronis data center URL [https://us15-cloud.acronis.com]: ').strip() or 'https://us15-cloud.acronis.com'
parsed = urllib.parse.urlsplit(url)
if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.acronis.com') or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
    raise SystemExit('Enter only the HTTPS Acronis data center origin. No changes saved.')
client_id = getpass.getpass('NEW Acronis client ID (hidden): ').strip()
secret = getpass.getpass('NEW Acronis client secret (hidden): ').strip()
if not client_id or not secret:
    raise SystemExit('Both values are required. No changes saved.')
config.update(ACRONIS_URL=url.rstrip('/')+'/', ACRONIS_CLIENT_ID=client_id, ACRONIS_CLIENT_SECRET=secret)
fd, temporary = tempfile.mkstemp(dir=file.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(config, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print('Acronis credentials saved securely. Restart Maldoori to load them.')
