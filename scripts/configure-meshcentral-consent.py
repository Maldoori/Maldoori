"""Require attended Windows agent desktop consent in a reviewed MeshCentral domain."""
import argparse
import json
import os
from pathlib import Path
import time

def key(mapping, name):
    matches = [k for k in mapping if k.lower() == name.lower()]
    if len(matches) > 1:
        raise ValueError('Ambiguous configuration keys: ' + name)
    return matches[0] if matches else name

def configure(config, domain_id):
    domains = config[key(config, 'domains')]
    if domain_id not in domains:
        raise ValueError('Requested domain is not in the MeshCentral configuration.')
    domain = domains[domain_id]
    consent_key = key(domain, 'userConsentFlags')
    flags = domain.get(consent_key, {})
    if type(flags) is int and flags >= 0:
        domain[consent_key] = flags | 73  # desktop notification, consent prompt, privacy bar
    elif isinstance(flags, dict):
        for flag in ('desktopnotify', 'desktopprompt', 'desktopprivacybar'):
            flags[key(flags, flag)] = True
        domain[consent_key] = flags
    else:
        raise ValueError('Unsupported userConsentFlags; configuration was not changed.')
    messages_key = key(domain, 'consentMessages')
    messages = domain.get(messages_key, {})
    if not isinstance(messages, dict):
        raise ValueError('Unsupported consentMessages; configuration was not changed.')
    for name in ('autoAcceptOnTimeout', 'autoAcceptIfNoUser', 'autoAcceptIfDesktopNoUser',
                 'autoAcceptIfLocked', 'autoAcceptIfDesktopLocked'):
        messages[key(messages, name)] = False
    messages[key(messages, 'consentTimeout')] = 60
    messages[key(messages, 'title')] = 'SkyBase IT Solutions - Remote support'
    messages[key(messages, 'desktop')] = '{0} from SkyBase IT Solutions requests permission to view and control your desktop. Allow this support session?'
    domain[messages_key] = messages
    return config

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/opt/meshcentral'))
    parser.add_argument('--domain', default='', help='Domain ID; default is the primary empty-ID domain')
    args = parser.parse_args()
    version = json.loads((args.root / 'node_modules/meshcentral/package.json').read_text()).get('version')
    if version != '1.1.59':
        raise SystemExit('Stopped: consent settings reviewed for MeshCentral 1.1.59 only.')
    path = args.root / 'meshcentral-data/config.json'
    if path.is_symlink() or not path.is_file():
        raise SystemExit('Stopped: configuration must be a regular non-symlink file.')
    original = path.read_bytes()
    config = json.loads(original)
    before = json.dumps(config, sort_keys=True)
    configure(config, args.domain)
    if json.dumps(config, sort_keys=True) == before:
        print('Required desktop consent settings are already configured; no changes made.')
        return
    suffix = str(time.time_ns())
    backup = path.with_name('config.json.skybase-consent-backup-' + suffix)
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(original)
    temporary = path.with_name('.skybase-consent-' + suffix)
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump(config, f, indent=2)
            f.write('\n')
        if path.read_bytes() != original:
            raise ValueError('Configuration changed during update; original remains untouched.')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    print('Desktop prompt, connection notification and privacy bar enabled for domain: ' + (args.domain or '(primary)'))
    print('Automatic desktop acceptance disabled. Prompt timeout: 60 seconds.')
    print('Private configuration backup: ' + str(backup))
    print('Restart MeshCentral, then test Allow, Deny, timeout and no-user behavior on a spare Windows PC.')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError):
        raise SystemExit('Stopped: configuration is incompatible or changed; check settings. No secrets printed.')
