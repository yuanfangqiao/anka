#pragma once
#include "imu_calibration.h"
#include "orientation.h"
typedef struct {
    anka_calibration_t pose;
    unsigned physical, screen, presses[2];
    bool module_online, imu_available;
    int module_error;
    anka_quat_t orientation;
    uint32_t orientation_id,imu_gaps;
} controller_calibration_status_t;
void controller_calibration_bound(void);
bool controller_session_locked(void);
bool controller_calibration_ready(void);
controller_calibration_status_t controller_calibration_status(void);
void controller_calibration_touch(unsigned mask);
void controller_calibration_virtual_button(unsigned button,bool pressed);
void controller_calibration_module(bool online,int error,unsigned mask);
bool controller_calibration_sample(const float gyro[3],const float accel[3],bool available,
                                   bool connected,uint32_t now,anka_quat_t *pose,uint32_t *id);
