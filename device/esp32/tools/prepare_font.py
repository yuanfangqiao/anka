"""Generate a small Chinese LVGL font from pinned official Mosaico resources."""
from pathlib import Path
import subprocess
from bootstrap import ROOT, PINS, archive

archive('esp-mosaico/esp-mosaico-utils', PINS['esp-mosaico-utils'], ROOT / '.deps/utils')
source = ROOT / '.deps/utils/esp-mosaico-vibe-mode/firmware/vibe-mode/ui/fonts/NotoSansSC-Regular.otf'
tools = Path(__file__).resolve().parent / 'font'
subprocess.run(['npm', 'install', '--no-audit', '--no-fund'], cwd=tools, check=True)
output = ROOT / '.deps/fonts/anka_font.c'
output.parent.mkdir(parents=True, exist_ok=True)
text = ''.join(sorted({ch for file in (ROOT / 'main').glob('*.c')
                       for ch in file.read_text() if '\u3400' <= ch <= '\u9fff'}))
subprocess.run(['node', str(tools / 'node_modules/lv_font_conv/lv_font_conv.js'),
                '--font', str(source), '--size', '22', '--bpp', '4', '--format', 'lvgl',
                '--range', '0x20-0x7f', '--symbols', text, '--no-compress',
                '--lv-include', 'lvgl.h', '-o', str(output)], check=True)
print('Generated:', output)
