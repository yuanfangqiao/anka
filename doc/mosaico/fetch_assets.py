"""Save official linked PDFs and recovery image, without flashing any hardware."""
import concurrent.futures
import hashlib
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent


def candidates():
    pages = json.loads((ROOT / 'sources/manifest.json').read_text())
    selected = {}
    for page in pages['entries']:
        for link in page.get('links', []):
            url = link['href']
            label = link['label']
            if urlsplit(url).hostname == 'dl.espressif.com' and '.pdf' in url.lower():
                selected[url] = label
            if 'Series Datasheet' in label:
                selected[url] = label
            if page['name'] == 'mosaico-firmware' and '下载固件' in label:
                selected[url] = 'Official recovery image'
    return selected.items()


def download(url, title):
    request = Request(url, headers={'User-Agent': 'Anka-Mosaico-Research/1.0'})
    with urlopen(request, timeout=90) as response:
        data = response.read(40 * 1024 * 1024 + 1)
        resolved = response.url
        media_type = response.headers.get_content_type()
    if len(data) > 40 * 1024 * 1024:
        raise ValueError('Asset exceeds 40 MiB limit')
    suffix = '.pdf' if data.startswith(b'%PDF') else '.html'
    if title == 'Official recovery image':
        # Official merged images may start with erased 0xff padding.
        if not any(len(data) > offset and data[offset] == 0xe9
                   for offset in (0, 0x1000, 0x2000)):
            raise ValueError('No ESP image header at supported bootloader offsets')
        suffix = '.bin'
    safe = ''.join(c.lower() if c.isascii() and c.isalnum() else '-' for c in title)
    safe = '-'.join(part for part in safe.split('-') if part)
    path = ROOT / 'sources' / (safe + suffix)
    path.write_bytes(data)
    return {'title': title, 'url': url, 'resolved_url': resolved, 'media_type': media_type,
            'path': str(path.relative_to(ROOT)), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()}


def main():
    entries = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        tasks = {executor.submit(download, url, title): (url, title)
                 for url, title in candidates()}
        for task in concurrent.futures.as_completed(tasks):
            url, title = tasks[task]
            try:
                item = task.result()
            except Exception as exc:
                item = {'title': title, 'url': url, 'error': str(exc)}
            entries.append(item)
            print(json.dumps(item, ensure_ascii=False), flush=True)
    manifest = {'retrieved_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
                'entries': sorted(entries, key=lambda item: item['title'])}
    (ROOT / 'sources/assets-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
