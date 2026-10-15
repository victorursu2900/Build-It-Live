#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>

Adafruit_ADS1115 ads;

const int SDA_PIN = 6;
const int SCL_PIN = 7;
const int S0_PIN = 10;
const int S1_PIN = 11;
const int S2_PIN = 2;
const int S3_PIN = 3;

#define MAX_HEIGHT 15

#define WINDOW_SIZE 30 // How many readings to keep in the history

float g_window[16][WINDOW_SIZE] = {0};
int window_idx[16] = {0};
bool window_filled[16] = {false};

float last_stable_G[16] = {0};
float candidate_G[16] = {0};
int stable_frames[16] = {0};

int tower_height[16] = {0};
int block_type[16][MAX_HEIGHT] = {0};
float block_delta[16][MAX_HEIGHT] = {0.0};

void setMuxChannel(int channel)
{
  digitalWrite(S0_PIN, bitRead(channel, 0));
  digitalWrite(S1_PIN, bitRead(channel, 1));
  digitalWrite(S2_PIN, bitRead(channel, 2));
  digitalWrite(S3_PIN, bitRead(channel, 3));
  delay(2);
}

void setup()
{
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  pinMode(S0_PIN, OUTPUT);
  pinMode(S1_PIN, OUTPUT);
  pinMode(S2_PIN, OUTPUT);
  pinMode(S3_PIN, OUTPUT);

  if (!ads.begin(0x48, &Wire))
  {
    Serial.println("ERROR: ADS1115 not found.");
    while (1)
      ;
  }

  ads.setGain(GAIN_ONE);
  ads.setDataRate(RATE_ADS1115_860SPS);
  delay(1000);      // Give the web serial connection a second to stabilize
  Serial.println(); // Flush any bootloader garbage
  Serial.println();
}

// --- Helper Functions to send the exact JSON the web app expects ---

// --- Simplified JSON Broadcaster ---
void sendHardwareEvent(int ch, const char *action, int z, float uS)
{
  Serial.print("{\"ch\":");
  Serial.print(ch);
  Serial.print(",\"action\":\"");
  Serial.print(action);
  Serial.print("\",\"z\":");
  Serial.print(z);
  Serial.print(",\"uS\":");
  Serial.print(uS, 1);
  Serial.println("}");
}

// --- Main Loop ---
void loop()
{
  // Loop through channel 0 and channel 1
  for (int ch = 0; ch < 4; ch++)
  {
    setMuxChannel(ch);

    // Give the multiplexer a tiny microsecond delay to physically switch pins before reading
    delayMicroseconds(10);

    long raw_sum = 0;
    for (int i = 0; i < 10; i++)
      raw_sum += ads.readADC_SingleEnded(0);
    float avg_voltage = ads.computeVolts(raw_sum / 10);

    float current_G = 0.0;
    if (avg_voltage > 0.1 && avg_voltage < 3.25)
    {
      current_G = 100.0 * (avg_voltage / (3.269 - avg_voltage));
    }

    g_window[ch][window_idx[ch]] = current_G;
    window_idx[ch]++;
    if (window_idx[ch] >= WINDOW_SIZE)
    {
      window_idx[ch] = 0;
      window_filled[ch] = true;
    }

    if (window_filled[ch])
    {
      float min_g = g_window[ch][0];
      float max_g = g_window[ch][0];
      float sum_g = 0;

      for (int i = 0; i < WINDOW_SIZE; i++)
      {
        float val = g_window[ch][i];
        if (val < min_g)
          min_g = val;
        if (val > max_g)
          max_g = val;
        sum_g += val;
      }

      float spread = max_g - min_g;

      // Proceed only if the physical connection is stable
      if (spread < 15.0)
      {
        float settled_G = sum_g / WINDOW_SIZE;

        // 1. Check for complete tower removal
        if (settled_G < 15.0 && tower_height[ch] > 0)
        {
          while (tower_height[ch] > 0)
          {
            int z = tower_height[ch] - 1;
            sendHardwareEvent(ch, "remove", z, block_delta[ch][z]);
            tower_height[ch]--;
          }
          last_stable_G[ch] = 0.0;
          return;
        }

        // 2. Evaluate Deltas
        if (abs(settled_G - last_stable_G[ch]) > 50)
        {
          float delta = settled_G - last_stable_G[ch];

          // Block Added (Just check if it's broadly a block, no specific IDs needed)
          if (delta > 60)
          {
            if (tower_height[ch] < MAX_HEIGHT)
            {
              int z = tower_height[ch];
              block_delta[ch][z] = delta; // Save the exact electrical weight
              tower_height[ch]++;
              last_stable_G[ch] = settled_G;

              sendHardwareEvent(ch, "add", z, delta);
            }
          }
          // Block(s) Removed
          else if (delta < -50)
          {
            while ((last_stable_G[ch] - settled_G) > 50 && tower_height[ch] > 0)
            {
              int z = tower_height[ch] - 1;
              float removed_uS = block_delta[ch][z];

              last_stable_G[ch] -= removed_uS;
              block_delta[ch][z] = 0.0;
              tower_height[ch]--;

              sendHardwareEvent(ch, "remove", z, removed_uS);
            }
            last_stable_G[ch] = settled_G;
          }
        }
      }
    }
  }
}