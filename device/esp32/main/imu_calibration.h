#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef enum { CAL_WAIT, CAL_HOLD, CAL_MOVING, CAL_TILT, CAL_RELEASE, CAL_READY, CAL_NO_IMU } anka_cal_phase_t;
typedef struct {
    bool bound, neutral_seen, bias_valid;
    anka_cal_phase_t phase;
    unsigned samples, progress;
    uint32_t began, ready_at, previous, last_both;
    float sum[3], square[3], acceleration[3], bias[3], up[3], right[3];
    float reference[3], turn[3], idle_sum[3], idle_square[3];
    unsigned idle_samples;
} anka_calibration_t;
void anka_calibration_bind(anka_calibration_t *cal);
void anka_calibration_step(anka_calibration_t *cal,const float gyro[3],const float accel[3],
                           unsigned chord,bool connected,bool available,uint32_t now);
bool anka_calibration_project(const anka_calibration_t *cal,const float gyro[3],float *yaw,float *pitch);
unsigned anka_calibration_hit(int x,int y);
