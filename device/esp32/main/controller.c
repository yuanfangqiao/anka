#include "controller.h"
#include <math.h>
#include <string.h>
#include "freertos/portmacro.h"

static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static controller_state_t state;
static bool fire_edge;
QueueHandle_t anka_action_queue;
const char *const anka_actions[9] = {"reload", "next_weapon", "grenade", "shield",
    "jump", "heal", "roll", "interact", "toggle_crouch"};

void controller_init(void) {
    anka_action_queue = xQueueCreate(16, sizeof(int));
    configASSERT(anka_action_queue);
}
controller_state_t controller_snapshot(bool consume_look) {
    portENTER_CRITICAL(&lock);
    controller_state_t result = state;
    result.fire = result.fire || fire_edge;
    if (consume_look) { state.yaw = state.pitch = 0; fire_edge = false; }
    portEXIT_CRITICAL(&lock);
    return result;
}
void controller_release(void) {
    portENTER_CRITICAL(&lock);
    bool connected = state.connected;float turn=state.turn;double turn_total=state.turn_total;
    anka_quat_t pose=state.orientation;uint32_t id=state.orientation_id;
    memset(&state, 0, sizeof(state)); state.connected = connected;
    state.orientation=pose;state.orientation_id=id;state.turn=turn;state.turn_total=turn_total;
    fire_edge=false;
    portEXIT_CRITICAL(&lock);
    if (anka_action_queue) xQueueReset(anka_action_queue);
    controller_ui_reset_touch();
}
void controller_pose(anka_quat_t q,uint32_t id) {
    portENTER_CRITICAL(&lock);state.orientation=q;state.orientation_id=id;portEXIT_CRITICAL(&lock);
}
void controller_connected(bool value) {
    controller_release();
    if(value)controller_calibration_bound();
    portENTER_CRITICAL(&lock); state.connected = value; portEXIT_CRITICAL(&lock);
}
void controller_move(float x, float y) {
    float scale = fmaxf(1, hypotf(x, y));
    portENTER_CRITICAL(&lock);
    if (state.armed) { state.move_x = x / scale; state.move_y = y / scale; }
    portEXIT_CRITICAL(&lock);
}
void controller_buttons(bool aim, bool fire) {
    if(!controller_calibration_ready())return;
    portENTER_CRITICAL(&lock);
    if (state.connected && !aim && !fire) state.armed = true;
    if (state.armed) { if(fire&&!state.fire)fire_edge=true;state.aim = aim; state.fire = fire; }
    portEXIT_CRITICAL(&lock);
}
void controller_turn(float degrees) {
    if(!isfinite(degrees)||degrees==0)return;
    portENTER_CRITICAL(&lock);
    if(state.armed&&state.connected){state.turn_total+=degrees;state.turn=(float)remainder(state.turn_total,360.);}
    portEXIT_CRITICAL(&lock);
}
void controller_look(float yaw, float pitch) {
    if (!isfinite(yaw) || !isfinite(pitch)) return;
    portENTER_CRITICAL(&lock);
    if (state.armed) {
        state.yaw = fmaxf(-45, fminf(45, state.yaw + yaw));
        state.pitch = fmaxf(-45, fminf(45, state.pitch + pitch));
    }
    portEXIT_CRITICAL(&lock);
}
void controller_action(int index) {
    controller_state_t s = controller_snapshot(false);
    if (index >= 0 && index < 9 && s.connected && s.armed)
        (void)xQueueSend(anka_action_queue, &index, 0);
}
