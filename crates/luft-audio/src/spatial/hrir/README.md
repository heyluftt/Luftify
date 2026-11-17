# KEMAR front-speaker impulse response

Copyright 1994 MIT Media Laboratory.
Authors: Bill Gardner and Keith Martin, *HRTF Measurements of a KEMAR Dummy-Head Microphone*, May 1994.

Source: https://sound.media.mit.edu/resources/KEMAR.html
Archive: https://sound.media.mit.edu/resources/KEMAR/diffuse.zip
Original member: elev0/H0e030a.wav (stored unchanged as front-30.wav).
Stereo PCM16, 44,100 Hz, 128 frames; 0 degree elevation, 30 degrees to the right.
Left channel = far ear; right channel = near ear. Mirroring yields the left speaker.

Use permission: the authors allow unrestricted use, with attribution in research and commercial applications.
The in-app Auto/Car note credits both authors and MIT. This is not a measured car response.

hrir_data.rs contains the exact PCM integers extracted with Python wave/struct.
binaural.rs applies shared gain/polarity and resamples once at initialization.
The diffuse-field equalization and interaural timing come from the source.
No user audio, network requests, convolution library or runtime assets are required.
