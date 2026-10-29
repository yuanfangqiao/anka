"""Apply/verify official camera fixes; git must not silently skip nested paths."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
patch = root / '.deps/bsp/components/mosaico_module_camera/patches/esp-cam-sensor-sc101iot-pclk-delay.patch'
sensor = root / 'managed_components/espressif__esp_cam_sensor/sensors/sc101iot/sc101iot.c'
dma = root / '.sdk/esp-idf/components/esp_driver_cam/dvp/private_include/esp_cam_ctlr_dvp_dma.h'


def patched():
    text = sensor.read_text()
    return ('#define SC101IOT_PCLK_DELAY_STEP 0U' in text and
            '0x3640, 0, 2, SC101IOT_PCLK_DELAY_STEP' in text)


if not patched():
    # git apply inside the enclosing Anka checkout otherwise reports success
    # while skipping every path outside its device/esp32 prefix. Stop discovery
    # at the PARENT of this app so --no-index uses the intended project root.
    env = dict(os.environ, GIT_CEILING_DIRECTORIES=str(root.parent))
    command = ['git', '-C', str(root), 'apply', '--no-index']
    subprocess.run([*command, '--check', str(patch)], env=env, check=True)
    subprocess.run([*command, str(patch)], env=env, check=True)
if not patched():
    raise SystemExit('SC101IOT PCLK patch is absent; refusing to build a broken camera')
if 'ESP_CAM_CTLR_DVP_DMA_FRAME_TAIL_SIZE' not in dma.read_text():
    raise SystemExit('Official DVP frame-stability patch is absent; refusing to build')
print('Verified actual camera sources: SC101IOT PCLK=0 ns and DVP frame-tail fix')
