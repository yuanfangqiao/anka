"""Exercise the actual C gesture, URL and QR decoder without hardware."""
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

root = Path(__file__).resolve().parents[1]
parser = root / '.sdk/esp-idf/components/http_parser'
quirc = root / '.deps/quirc/lib'
url = 'https://anka.example:8443/v1/device/join?bindKey=abcdefghijklmnop&token=abcdefghijklmnop0123456789'
with TemporaryDirectory() as temporary:
    directory = Path(temporary)
    # Use the game's existing QR encoder; no extra Python package is required.
    encode = """import QR from 'qrcode';import{writeFileSync}from'node:fs';
const q=QR.create(process.argv[1],{errorCorrectionLevel:'M'}),margin=4,scale=6;
const size=(q.modules.size+margin*2)*scale,p=Buffer.alloc(size*size,255);
for(let y=0;y<q.modules.size;y++)for(let x=0;x<q.modules.size;x++)if(q.modules.get(y,x))
for(let j=0;j<scale;j++)for(let i=0;i<scale;i++)p[((y+margin)*scale+j)*size+(x+margin)*scale+i]=0;
writeFileSync(process.argv[2],Buffer.concat([Buffer.from(`P5\\n${size} ${size}\\n255\\n`),p]));"""
    subprocess.run(['node', '--input-type=module', '-e', encode, url, str(directory/'qr.pgm')],
                   cwd=root.parents[1]/'plugins/anka-outpost-strike', check=True)
    sources = [root/'tests/host.c', root/'tests/calibration.c', root/'main/imu_calibration.c', root/'main/orientation.c', root/'tests/orientation.c', root/'main/gesture.c', root/'main/navigation.c', root/'main/controller_url.c', root/'main/camera_pixels.c', root/'main/qr_pixels.c', parser/'http_parser.c']
    sources += [quirc/name for name in ['quirc.c', 'decode.c', 'identify.c', 'version_db.c']]
    subprocess.run(['cc', '-std=c11', '-O2', '-DQUIRC_FLOAT_TYPE=float', '-DQUIRC_USE_TGMATH=1', '-DQUIRC_MAX_REGIONS=1024', '-Wall', '-Wextra', '-I'+str(root/'main'),
                    '-I'+str(parser), '-I'+str(quirc), *map(str,sources), '-lm', '-o', str(directory/'check')], check=True)
    subprocess.run([str(directory/'check'), str(directory/'qr.pgm'), url], check=True)
