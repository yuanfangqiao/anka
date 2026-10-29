#pragma once
#include <stdbool.h>
#include <stddef.h>
bool controller_url_join(const char *source, bool insecure, char *out, size_t size);
bool controller_url_origin(const char *join, char *out, size_t size);
