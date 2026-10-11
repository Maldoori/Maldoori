#!/usr/bin/env python3
"""Read-only API discovery. Print structure only, never credentials or provider bodies."""
import base64
import json
from pathlib import Path
import stat
import urllib.error
import urllib.parse
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def shape(value, depth=0):
    if depth > 5:
        return type(value).__name__
    if isinstance(value, dict):
        return {key: shape(item, depth + 1) for key, item in list(value.items())[:60]
                if not any(word in key.lower() for word in ('token', 'secret', 'password', 'credential', 'authorization'))}
    if isinstance(value, list):
        return {'count': len(value), 'first_item_structure': shape(value[0], depth + 1) if value else None}
    return type(value).__name__

def main():
    file = Path('/etc/maldoori/credentials.json')
    metadata = file.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise ValueError('Credentials file must have owner-only permissions.')
    config = json.loads(file.read_text())
    origin = config.get('ACRONIS_URL', '')
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.acronis.com') or parsed.username or parsed.password or parsed.port or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('Acronis data center URL is not configured correctly.')
    client_id, secret = config.get('ACRONIS_CLIENT_ID'), config.get('ACRONIS_CLIENT_SECRET')
    if not client_id or not secret:
        raise ValueError('Acronis API credentials are missing.')
    opener = urllib.request.build_opener(NoRedirect())
    auth = base64.b64encode((client_id + ':' + secret).encode()).decode()
    request = urllib.request.Request(origin.rstrip('/') + '/api/2/idp/token',
        data=b'grant_type=client_credentials', headers={'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded'})
    with opener.open(request, timeout=20) as response:
        token = json.load(response)['access_token']
    print('Authentication: OK')
    endpoints = ['/api/2/clients/' + urllib.parse.quote(client_id, safe=''),
                 '/api/resource_management/v4/resources', '/api/task_manager/v2/tasks']
    for number, path in enumerate(endpoints, start=1):
        print('\nCheck', number, ('API client scope', 'Resource inventory', 'Task history')[number - 1])
        try:
            req = urllib.request.Request(origin.rstrip('/') + path, headers={'Authorization': 'Bearer ' + token})
            with opener.open(req, timeout=20) as response:
                data = response.read(2 * 1024 * 1024 + 1)
                if len(data) > 2 * 1024 * 1024:
                    print('Response too large; omitted.'); continue
                value = json.loads(data)
                print('HTTP:', response.status)
                print(json.dumps(shape(value), indent=2))
        except urllib.error.HTTPError as error:
            print('HTTP:', error.code, '(response body omitted)')
        except Exception:
            print('Could not read this API response; details omitted.')

if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        print('Authentication HTTP:', error.code, '(response body omitted)')
        raise SystemExit(1)
    except Exception:
        print('Check failed. Verify saved credentials, file permissions, and network. No secrets printed.')
        raise SystemExit(1)
