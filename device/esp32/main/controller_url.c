#include "controller_url.h"
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include "http_parser.h"

static bool query_value(const char *query, const char *name) {
    size_t n = strlen(name);
    for (const char *p = query; *p;) {
        const char *end = strchr(p, '&'); if (!end) end = p + strlen(p);
        if ((size_t)(end-p) > n && !strncmp(p, name, n) && p[n] == '=') {
            size_t length = end-p-n-1;
            return length >= 16 && length <= 128 &&
                strspn(p+n+1, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_") >= length;
        }
        p = *end ? end+1 : end;
    }
    return false;
}
bool controller_url_join(const char *source, bool insecure, char *out, size_t size) {
    if (!source || strlen(source) > 1000 || strpbrk(source, "\r\n\t ") || strchr(source, '#')) return false;
    struct http_parser_url url = {0};
    if (http_parser_parse_url(source, strlen(source), 0, &url)) return false;
    if (!(url.field_set & (1 << UF_HOST)) || url.field_set & (1 << UF_USERINFO)) return false;
    const char *host=source+url.field_data[UF_HOST].off;unsigned host_len=url.field_data[UF_HOST].len;
    if((host_len==9&&!strncasecmp(host,"localhost",9)) ||
       (host_len>=4&&!strncmp(host,"127.",4)) || (host_len==3&&!strncmp(host,"::1",3)) ||
       (host_len==7&&!strncmp(host,"0.0.0.0",7)))return false;
    bool secure = (url.field_data[UF_SCHEMA].len == 5 && !strncasecmp(source, "https", 5)) ||
                  (url.field_data[UF_SCHEMA].len == 3 && !strncasecmp(source, "wss", 3));
    bool plain = (url.field_data[UF_SCHEMA].len == 4 && !strncasecmp(source, "http", 4)) ||
                 (url.field_data[UF_SCHEMA].len == 2 && !strncasecmp(source, "ws", 2));
    if (!secure && !(insecure && plain)) return false;
    const char *path = source + url.field_data[UF_PATH].off;
    if (url.field_data[UF_PATH].len != strlen("/v1/device/join") ||
        strncmp(path, "/v1/device/join", url.field_data[UF_PATH].len)) return false;
    if (!(url.field_set & (1 << UF_QUERY))) return false;
    const char *query = source + url.field_data[UF_QUERY].off;
    if (!query_value(query, "bindKey") || !query_value(query, "token")) return false;
    int written = snprintf(out, size, "%s%s", secure ? "wss" : "ws", strchr(source, ':'));
    return written > 0 && (size_t)written < size;
}
bool controller_url_origin(const char *join, char *out, size_t size) {
    const char *scheme = strstr(join, "://"); if (!scheme) return false;
    const char *path = strchr(scheme+3, '/'); if (!path) return false;
    size_t length = path-join;
    if (length >= size) return false;
    memcpy(out, join, length); out[length] = 0; return true;
}
