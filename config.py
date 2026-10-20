"""Small, non-executing .env reader shared by the server and install check."""
import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import shlex

ROOT = Path(__file__).resolve().parent
KEYS = {'KLASSENBUCH_BIND', 'KLASSENBUCH_PORT'}


def read_env(path):
    if not path.exists():
        return {}
    settings = {}
    for number, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()
        name, separator, value = line.partition('=')
        name = name.strip()
        if name not in KEYS:
            continue
        if not separator:
            raise ValueError(f'.env: Zuweisung für {name} in Zeile {number} erforderlich')
        try:
            parts = shlex.split(value, comments=True, posix=True)
        except ValueError:
            raise ValueError(f'.env: Ungültige Anführungszeichen für {name} in Zeile {number}') from None
        if len(parts) != 1:
            raise ValueError(f'.env: Genau ein Wert für {name} in Zeile {number} erforderlich')
        settings[name] = parts[0]
    return settings


@dataclass(frozen=True)
class Config:
    bind: str
    port: int
    data_dir: str

    @property
    def health_url(self):
        host = {'0.0.0.0': '127.0.0.1', '::': '::1'}.get(self.bind, self.bind)
        if ':' in host:
            host = f'[{host}]'
        return f'http://{host}:{self.port}/healthz'


def load_config(argv=None, environ=None, env_path=None):
    environ = os.environ if environ is None else environ
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', help='Bind-Adresse; überschreibt .env/Umgebung')
    parser.add_argument('--port', type=int, help='Port; überschreibt .env/Umgebung')
    parser.add_argument('--data-dir', default=environ.get('KLASSENBUCH_DATA_DIR', str(Path.home() / '.local/share/klassenbuch')))
    args = parser.parse_args(argv)
    try:
        file_settings = read_env(ROOT / '.env' if env_path is None else Path(env_path))
    except (ValueError, OSError) as error:
        parser.error(str(error))
    settings = {**file_settings, **{key: environ[key] for key in KEYS if key in environ}}
    bind = args.bind if args.bind is not None else settings.get('KLASSENBUCH_BIND', '127.0.0.1')
    if not bind or any(char.isspace() for char in bind) or any(char in bind for char in '/[]?#$'):
        parser.error('KLASSENBUCH_BIND/--bind: gültige IP-Adresse oder Hostname ohne Leerzeichen erforderlich')
    try:
        port = args.port if args.port is not None else int(settings.get('KLASSENBUCH_PORT', '8085'))
    except ValueError:
        parser.error('KLASSENBUCH_PORT: ganze Zahl von 1 bis 65535 erforderlich')
    if not 1 <= port <= 65535 and not (args.port == 0):
        parser.error('Port muss zwischen 1 und 65535 liegen (CLI --port 0 nur für Tests)')
    return Config(bind, port, args.data_dir)
