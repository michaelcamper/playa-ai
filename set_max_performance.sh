#!/bin/bash
# Set Jetson to maximum performance mode for consistent TTS performance

echo "Setting Jetson to maximum performance mode..."

# Set to max performance mode (mode 0)
sudo nvpmodel -m 0

# Set CPU governor to performance
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu1/cpufreq/scaling_governor'
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu2/cpufreq/scaling_governor'
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu3/cpufreq/scaling_governor'
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu4/cpufreq/scaling_governor'
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu5/cpufreq/scaling_governor'
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu6/cpufreq/scaling_governor'
sudo sh -c 'echo performance > /sys/devices/system/cpu/cpu7/cpufreq/scaling_governor'

# Enable all CPU cores
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu0/online'
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu1/online'
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu2/online'
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu3/online'
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu4/online'
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu5/online'
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu6/online'
sudo sh -c 'echo 1 > /sys/devices/system/cpu/cpu7/online'

# Maximize GPU clocks
sudo jetson_clocks

echo "Performance mode activated!"
echo "Current power mode:"
sudo nvpmodel -q

# Show current CPU frequencies
echo ""
echo "CPU frequencies:"
grep MHz /proc/cpuinfo | head -8
