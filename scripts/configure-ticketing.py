#!/usr/bin/env python3
"""Configure IMAP ticket intake and OpenAI without putting secrets in shell history."""
import getpass
import json
import os
from pathlib import Path
import re
import stat
import tempfile

path = Path('/etc/maldoori/credentials.json')
metadata = path.lstat()
if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
    raise SystemExit('Credentials must be an owner-only regular file (chmod 600).')
config = json.loads(path.read_text())
if input('Configure support mailbox via IMAP? [y/N]: ').strip().lower() == 'y':
    address = input('Support email address: ').strip()
    print('Namecheap Private Email normally uses mail.privateemail.com. Hosting/cPanel email uses the server shown in cPanel > Email Accounts > Connect Devices.')
    host = input('IMAP server hostname (TLS port 993): ').strip()
    user = input('IMAP username [support email]: ').strip() or address
    password = getpass.getpass('IMAP password or app password (hidden; Enter keeps existing): ').strip() or config.get('TICKET_IMAP_PASSWORD', '')
    folder = input('Mail folder [INBOX]: ').strip() or 'INBOX'
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', address) or not re.fullmatch(r'[a-zA-Z0-9.-]+', host) or host in ('localhost','127.0.0.1') or not password:
        raise SystemExit('Enter a valid email, IMAP hostname, and password. No changes saved.')
    config.update(SUPPORT_EMAIL=address, TICKET_EMAIL_PROVIDER='imap', TICKET_IMAP_HOST=host, TICKET_IMAP_USER=user, TICKET_IMAP_PASSWORD=password, TICKET_IMAP_FOLDER=folder, TICKET_EMAIL_ENABLED='true')
if input('Configure OpenAI ticket reviews? [y/N]: ').strip().lower() == 'y':
    key = getpass.getpass('OpenAI API key (hidden; Enter keeps existing): ').strip() or config.get('OPENAI_API_KEY', '')
    if not key:
        raise SystemExit('An API key is required. No changes saved.')
    model = input('OpenAI model [gpt-4.1-mini]: ').strip() or 'gpt-4.1-mini'
    automatic = input('Automatically analyze incoming email tickets? Sends ticket text to OpenAI and uses paid API calls. [y/N]: ').strip().lower() == 'y'
    config.update(OPENAI_API_KEY=key, TICKET_AI_MODEL=model, TICKET_AI_AUTO='true' if automatic else 'false')
fd, temporary = tempfile.mkstemp(dir=path.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(config, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print('Ticketing settings saved securely. Restart Maldoori to load them. IMAP imports new mail after its first successful connection.')
