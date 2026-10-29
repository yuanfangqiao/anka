#include "pairing.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
static portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
static pair_status_t state;
pair_status_t controller_pair_status(void) {
    portENTER_CRITICAL(&lock);pair_status_t result=state;portEXIT_CRITICAL(&lock);return result;
}
uint32_t controller_pair_reset(void) {
    portENTER_CRITICAL(&lock);state.generation++;state.stage=PAIR_SCAN;state.error=PAIR_OK;
    state.changed_ms=esp_timer_get_time()/1000;uint32_t gen=state.generation;portEXIT_CRITICAL(&lock);return gen;
}
bool controller_pair_update(uint32_t generation,pair_stage_t stage,pair_error_t error) {
    portENTER_CRITICAL(&lock);bool current=generation==state.generation;
    bool changed=current&&(state.stage!=stage||state.error!=error);
    if(changed){
        state.stage=stage;state.error=error;state.changed_ms=esp_timer_get_time()/1000;
    }
    pair_status_t result=state;portEXIT_CRITICAL(&lock);
    if(changed)ESP_LOGI("handpad","pairing: %s",controller_pair_label(result));
    return current;
}
const char *controller_pair_label(pair_status_t s) {
    if(s.stage==PAIR_ERROR){
        const char *errors[]={"RETRY","INVALID QR","LOCALHOST","LINK FAILED","QR EXPIRED","CAMERA","CLOCK","PAUSED","GAME CLOSED","UNBOUND"};
        return errors[s.error<=PAIR_UNBOUND?s.error:0];
    }
    const char *labels[]={"SCANNING","QR FOUND","CONNECTING","WAIT WI-FI","CONNECTED","RETRY"};
    return labels[s.stage<=PAIR_ERROR?s.stage:0];
}
