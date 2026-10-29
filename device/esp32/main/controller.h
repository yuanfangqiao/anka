#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "controller_url.h"
#include "pairing.h"
#include "controller_calibration.h"

typedef struct {
    float move_x, move_y, yaw, pitch, turn;
    double turn_total;
    bool fire, aim, connected, armed;
    anka_quat_t orientation;
    uint32_t orientation_id;
} controller_state_t;
extern const char *const anka_actions[9];
extern QueueHandle_t anka_action_queue;
void controller_init(void);
controller_state_t controller_snapshot(bool consume_look);
void controller_connected(bool value);
void controller_move(float x, float y);
void controller_buttons(bool aim, bool fire);
void controller_turn(float degrees);
void controller_look(float yaw, float pitch);
void controller_pose(anka_quat_t q,uint32_t id);
void controller_motion_start(void);
void controller_action(int index);
void controller_release(void);
void controller_ui_init(void);
void controller_ui_notice(const char *text);
void controller_ui_reset_touch(void);
void controller_ui_preview(const uint16_t *rgb, int width, int height);
void controller_sensors_start(void);
void controller_feedback(float strength, uint32_t duration_ms);
void controller_wifi_start(void);
bool controller_wifi_ready(void);
const char *controller_wifi_source(void);
void controller_link_start(void);
bool controller_link_join(const char *url);
void controller_link_reset(void);
void controller_link_error(char *out,size_t size);
void controller_scan_start(void);

void controller_exit(void);
void controller_system_start(void);
bool controller_exiting(void);
void controller_debug_start(void);
void controller_scan_cancel(void);
bool controller_scan_active(void);
bool controller_scan_boot_attempted(void);
uint32_t controller_scan_frames(void);
int controller_scan_error(void);
bool controller_scan_accept(const char *url, uint32_t generation);
uint32_t controller_scan_decodes(void);
uint32_t controller_scan_decode_us(void);
uint32_t controller_scan_preview_us(void);
uint32_t controller_ui_preview_frames(void);
uint32_t controller_scan_qr_reads(void);
bool controller_ui_handpad_visible(void);
