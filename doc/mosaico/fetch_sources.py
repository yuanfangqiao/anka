"""Download public vendor documentation; never install or run upstream code."""
import concurrent.futures
import hashlib
import json
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
PAGES = {
    'mosaico-guide': 'https://mosaico.ai/zh-hans/guide',
    'mosaico-faq': 'https://mosaico.ai/zh-hans/faq',
    'mosaico-software': 'https://mosaico.ai/zh-hans/software',
    'mosaico-firmware': 'https://mosaico.ai/zh-hans/firmware',
    'mosaico-hardware-v1.2': 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide.html',
    'mosaico-hardware-v1.0': 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide_v1.0.html',
    'mosaico-interaction-module': 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide_interact.html',
    'mosaico-camera-module': 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide_camera.html',
    'esp-websocket-client': 'https://docs.espressif.com/projects/esp-protocols/esp_websocket_client/docs/latest/index.html',
    'w3c-orientation-motion': 'https://www.w3.org/TR/orientation-event/',
}


class Extractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.links, self.href, self.label = [], [], None, []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in ('script', 'style'):
            self.skip += 1
        if tag == 'a':
            self.href, self.label = values.get('href'), []
        if tag in ('p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        if tag == 'a' and self.href:
            self.links.append({'href': self.href, 'label': ''.join(self.label).strip()})
            self.href = None

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
            if self.href:
                self.label.append(data)


def download(name, url):
    path = ROOT / 'sources' / (name + '.html')
    request = Request(url, headers={'User-Agent': 'Anka-Mosaico-Research/1.0'})
    with urlopen(request, timeout=60) as response:
        data = response.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024:
            raise ValueError('Page exceeds download limit')
        resolved = response.url
    path.write_bytes(data)
    parser = Extractor()
    parser.feed(data.decode('utf-8', errors='replace'))
    lines = [line.strip() for line in ''.join(parser.parts).splitlines()]
    text = '\n'.join(line for line in lines if line)
    path.with_suffix('.txt').write_text(text + '\n', encoding='utf-8')
    interesting = [dict(link, href=urljoin(resolved, link['href'])) for link in parser.links
                   if any(word in (link['href'] + link['label']).lower()
                          for word in ('.pdf', '.bin', 'download', '原理图', 'schematic', 'datasheet'))]
    return {'name': name, 'url': url, 'resolved_url': resolved,
            'path': str(path.relative_to(ROOT)), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(), 'links': interesting}


def main():
    entries = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        tasks = {executor.submit(download, name, url): (name, url)
                 for name, url in PAGES.items()}
        for task in concurrent.futures.as_completed(tasks):
            name, url = tasks[task]
            try:
                item = task.result()
                entries.append(item)
                print(json.dumps({'name': name, 'bytes': item['bytes'], 'links': item['links']},
                                 ensure_ascii=False), flush=True)
            except Exception as exc:
                entries.append({'name': name, 'url': url, 'error': str(exc)})
                print(json.dumps({'name': name, 'error': str(exc)}, ensure_ascii=False), flush=True)
    manifest = {'retrieved_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
                'entries': sorted(entries, key=lambda item: item['name'])}
    (ROOT / 'sources' / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
