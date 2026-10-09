"""Back up live SQLite data, including WAL state, without displaying records."""
import argparse
import datetime
import os
from pathlib import Path
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('--database', default='/opt/maldoori/data/rmm.sqlite')
parser.add_argument('--output-dir', default='/root/maldoori-backups')
args = parser.parse_args()
source = Path(args.database).resolve()
if not source.is_file():
    raise SystemExit('Database not found; no backup created. Check the configured DATA_DIR.')
folder = Path(args.output_dir)
folder.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(folder, 0o700)
destination = folder / ('rmm-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite')
destination.touch(mode=0o600, exist_ok=False)
original = saved = None
try:
    original = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    saved = sqlite3.connect(destination)
    original.backup(saved)
    if saved.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise RuntimeError('Backup integrity check failed.')
except Exception:
    if saved is not None:
        saved.close()
        saved = None
    destination.unlink(missing_ok=True)
    raise
finally:
    if saved is not None:
        saved.close()
    if original is not None:
        original.close()
print('Database backup verified:', destination)
