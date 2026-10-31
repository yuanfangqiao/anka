"""Static, backwards-compatible frontend runtime policy validation."""


def parse_runtime(manifest, value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        manifest.fail('E_MANIFEST_FIELD', 'runtime 必须是对象', field='runtime')
        return {}
    allowed = {'keepAlive', 'preload', 'background', 'apiVersion'}
    result = {}
    for key, item in value.items():
        valid = ((key == 'keepAlive' and isinstance(item, bool))
                 or (key == 'preload' and item in ('none', 'resources', 'execute'))
                 or (key == 'background' and item in ('pause', 'continue'))
                 or (key == 'apiVersion' and type(item) is int and item == 1))
        if key not in allowed or not valid:
            manifest.fail('E_MANIFEST_FIELD', f'runtime.{key} 无效',
                          field=f'runtime.{key}')
        else:
            result[key] = item
    return result
