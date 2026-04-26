import time
import numpy as np

ANGLE_THRESHOLD = 65
FALL_CONFIRM_TIME = 0   # seconds person must be down before alert
FALL_COOLDOWN = 2      # seconds before same person can trigger again


class FallDetector:
    def __init__(self):
        self.fall_timers = {}      # person_id -> time they first went down
        self.fall_cooldowns = {}   # person_id -> time last alert fired

    def detect_fall(self, keypoints, bbox, person_id):
        left_shoulder  = keypoints[5]
        right_shoulder = keypoints[6]
        left_hip       = keypoints[11]
        right_hip      = keypoints[12]

        # Skip if keypoints missing (zeros)
        if (left_shoulder[0] == 0 and right_shoulder[0] == 0) or \
           (left_hip[0] == 0 and right_hip[0] == 0):
            return False

        shoulder_mid = (left_shoulder + right_shoulder) / 2
        hip_mid      = (left_hip + right_hip) / 2

        dx = hip_mid[0] - shoulder_mid[0]
        dy = hip_mid[1] - shoulder_mid[1]

        angle = np.degrees(np.arctan2(abs(dx), abs(dy)))

        now = time.time()

        if angle > ANGLE_THRESHOLD:
            # Start timer if not already running
            if person_id not in self.fall_timers:
                self.fall_timers[person_id] = now

            elapsed = now - self.fall_timers[person_id]

            # Confirm fall after threshold time
            if elapsed >= FALL_CONFIRM_TIME:
                # Check cooldown — don't re-alert same person too fast
                last = self.fall_cooldowns.get(person_id, 0)
                if now - last >= FALL_COOLDOWN:
                    self.fall_cooldowns[person_id] = now
                    return True
        else:
            # Person is upright — reset
            self.fall_timers.pop(person_id, None)

        return False