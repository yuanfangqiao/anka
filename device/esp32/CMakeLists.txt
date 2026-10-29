cmake_minimum_required(VERSION 3.16)
set(IDF_TARGET esp32s31 CACHE STRING "ESP-Mosaico target")
set(BSP_COMPONENTS "${CMAKE_CURRENT_LIST_DIR}/.deps/bsp/components")
if(NOT EXISTS "${BSP_COMPONENTS}/esp-mosaico-bsp/CMakeLists.txt")
    message(FATAL_ERROR "Run python tools/bootstrap.py first")
endif()
set(EXTRA_COMPONENT_DIRS
    "${BSP_COMPONENTS}/esp-mosaico-bsp"
    "${BSP_COMPONENTS}/mosaico_module_mgr"
    "${BSP_COMPONENTS}/mosaico_module_interact"
    "${BSP_COMPONENTS}/mosaico_module_camera"
    "${BSP_COMPONENTS}/touch_button")
set(MOSAICO_UTILS_ROOT "${CMAKE_CURRENT_LIST_DIR}/.deps/utils")
set(MOSAICO_BSP_ROOT "${CMAKE_CURRENT_LIST_DIR}/.deps/bsp")
set(SDKCONFIG_DEFAULTS "sdkconfig.defaults")
list(APPEND EXTRA_COMPONENT_DIRS
    "${MOSAICO_UTILS_ROOT}/ESP-Iris/components/esp_iris"
    "${MOSAICO_UTILS_ROOT}/esp-mosaico-vibe-mode/components/esp_mosaico_app_recovery")
include("${MOSAICO_UTILS_ROOT}/esp-mosaico-vibe-mode/cmake/mosaico_idf_project.cmake")
idf_build_set_property(MINIMAL_BUILD ON)
project(anka_handpad VERSION 0.4.1)

# BSP's Git-based patch detection can silently skip paths in nested checkouts.
# Component Manager has resolved sources by this point; validate actual content.
execute_process(COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/tools/check_camera_patches.py"
    RESULT_VARIABLE CAMERA_PATCH_RESULT)
if(NOT CAMERA_PATCH_RESULT EQUAL 0)
    message(FATAL_ERROR "Camera source patch verification failed")
endif()

include("${MOSAICO_UTILS_ROOT}/mosaico-tools/cmake/system_update.cmake")
