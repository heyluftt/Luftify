# 0.1.38

- Cover flight more reliable
- More stable playback after reconnects
- New start: welcome, sign-in and loading indicator

# 0.1.37

- Songs keep loading when skipping quickly instead of getting stuck for minutes
- Luftify now plays only through Libre; Spotify Desktop and Spicetify are no longer needed
- Skipping forward and back responds immediately, even with quick clicks
- On first start you sign in to Spotify directly instead of choosing an engine
- Missing audio keys no longer cause the queue to skip through tracks
- Listen along recognizes track endings even when status updates are delayed
- The music room shows the lyrics on the left, with a small button to hide them
- Skipping, pausing and seeking take effect at once and softly, without clicks or leftover reverb from the previous song
- Connects even when IPv6 does not work on the network, e.g. with a VPN and split tunneling
- Prisma takes on the cover's colors much more strongly: room, light and accents
- When a new song waits for Spotify's limit, the player bar shows it with a countdown
- Music room lyrics are larger, use more width and are no longer cut off
- Libre connects on its own when the network was not ready at startup
- Songs flow into each other without a gap; the play button no longer flips to Pause for a moment at song changes
- The collapsed player bar disappears completely in the lyrics and cover views too
- The canvas can be hidden in the cover view and the music room as well
- Friends, messages and listen together are currently unavailable and marked as such
- New versions are announced without the update server too, with a download link
- Spotify limit: shorter wait that no longer starts over when skipping; skipped songs no longer use anything up
- Reordering the queue: the dragged song lifts and the others make room
- Livelier motion: page changes, cards, player bar, menus and sidebar spring softly
- Play on a card: the cover flies into the player bar
- New "Animations" setting: like Windows, full, subtle or off

# 0.1.36

- Libre resumes music after a later reconnection attempt succeeds
- Retry Canvas after a loading error when returning to the song
- Listening along follows repeated songs without needing to rejoin

# 0.1.35

- Music room: title and artist blend directly into the background atmosphere

# 0.1.34

- More compact titles and information card in the music room

# 0.1.33

- Music room: unclipped title descenders, continuous background behind the search bar and a quieter collapsed player

# 0.1.32

- Profile song card easier to read with dark and light profile colors
- Respect Spotify's waiting periods for rate-limited web requests
- New releases briefly wait for library data at startup
- New music room with Canvas lighting, fullscreen and artwork fallback in Lyrics

# 0.1.31

- Profile rearranged: name, badges and status more compact, profile song and played songs further up

# 0.1.30

- Songs no longer skip ahead on short network hiccups and start a little faster
- After a brief disconnect from Spotify the song continues at the right spot instead of from the start
- Diagnostics: test whether Spotify delivers lossless music (FLAC) to your account

# 0.1.29

- Playlists with songs that are no longer available open faster
- Background preparing no longer loads a playlist twice
- Adding and removing songs in playlists is faster
- New releases on the home page are back: new albums and singles from your artists
- Chat: read messages no longer count at the bell, new ones show up in the conversation right away, “new messages” while scrolled up
- Listening analysis: top artist pictures show up right away, top playlists load faster
- Luftify cleans up old log files and writes less: often saves several hundred MB
- Chat messages arrive instantly instead of after a few seconds, and the app checks less often
- Luft overview: daily server backup with its status
- Luft overview: last PC and phone version, also offline

# 0.1.28

- Much faster: song details arrive in batches instead of one by one, large playlists load much faster
- Luftify remembers songs across all playlists, albums, search and the queue, also after a restart
- Often played playlists are prepared quietly after start
- New on this PC: a short setup screen with progress
- Liked songs, artist pages and search load faster; in the background the chat checks less often

# 0.1.27

- Private messages between friends with history and unread messages
- Open chats directly from friends and profiles
- Turn chat notifications on or off separately
- Fix starting development mode on Windows
- Chat: Spotify links as cards with play and open, share the current song in one click
- Chat: grouped messages, “Seen”, and what your friend is playing, with listen along
- Collaborative playlists: new songs since your last visit are marked
- Setting playlist images works now (the way the Spotify web player does it)
- Chat redesigned: online dot and status in the list, a welcome with quick starts, bubbles in your colour, a slim input

# 0.1.26

- Contributors shown next to preload, with more people available through “+”
- Choose and crop playlist images, including contributors with Spotify editing permissions

# 0.1.25

- Profile backgrounds fade smoothly, colors match and the scrollbar is hidden
- Collaborative playlists show contributors and song contributions with Luftify names
- Collaborative playlists are available below new releases on the home page

# 0.1.24

- Profile frames redrawn and animated, plus a new one: Sound wave
- Profile backgrounds with more depth and gentle motion, plus a new one: City lights
- Effects reworked (stars, crystal light, waves, aurora, light particles), plus a new one: Falling petals
- Edit your profile with clearer choices and a live preview
- Custom profile colours and name gradients are easier to adjust

# 0.1.23

- Listening along no longer stops when the song changes

# 0.1.22

- Small theme objects with finer shapes and matching animations; orbiting spheres follow their paths
- Listening insights: “1 play” instead of “1 plays”, playlists outside your library show name and cover
- Listen together without server settings; Luftify connects on its own
- Names and titles are no longer cut off at the bottom (g, y, p)
- Open Spotify links: paste with Ctrl+V, then play, open or queue
- Create, rename and delete playlists
- Collaborative playlists: send them to friends, who join with one click

# 0.1.21

- Control from your phone: pick the PC as the device in Luftify on the phone
- Listening status with phone and PC no longer flips back and forth

# 0.1.20

- Link a phone: your friends profile in Luftify on your phone, too

# 0.1.19

- Achievements in the profile only when you turn them on
- Notifications: a bell with history, each kind can be turned off
- Notices with profile picture and time left
- Luft Violet redesigned

# 0.1.18

- Edit profile: tidier look tab, colour picker only when needed
- Own name gradient “from … to …” and ready-made gradients
- Achievements shown in the profile
- Announcements from Luft appear in the app

# 0.1.17

- More compact listening stats: chart value only on hover, listening profile and Smart Start removed

# 0.1.16

- New listening stats: listening time with its course and the change against the period before, your number ones, top 10, time of day and weekdays, how you listen

# 0.1.15

- “Listening now”: names keep their distance from the picture, three cards fit side by side
- New recaps page: listening calendar for the whole year, highlights, every month as a calendar, weeks with trend, switch between years
- Recaps: go straight to the next new recap at the end
- Recaps play their music much quieter, and silent when the player is muted

# 0.1.14

- Version history in the settings under Updates
- Hide what you play from single friends (in the friend’s profile, “…” menu)
- New friends page: readable profile card, numbers at a glance, “Listening now” with progress, requests and search alongside
- “Edit” only on the friends page, no longer in your own profile view

# 0.1.13

- Recovery code: take your friends profile to a new PC (Settings → Profile)
- After a crash or freeze, Luftify offers “Report a problem” on the next start
- Listen together: rooms stay open through server updates
- Uses less memory when minimised or in the tray

# 0.1.12

- Achievements: small goals with badges as rewards, plus the Aurum frame
- Badge inventory: choose which badges your profile shows, and in which order
- Listen along: the player bar shows the right song right away
- Friends show who is listening along with you and whom you are listening along with
- Listening along follows song changes faster
- Artist names are no longer cut off at the bottom
- Edit profile: the save bar is fully visible
- Profile frames show the right colour in the profile view too

# 0.1.11

- Listen along: follow what a friend is playing, no room needed
- Playing your own music stops listening along immediately; volume stays independent
- Listening together starts with the song that is playing and your queue
- Invitations show what is playing
- Music keeps playing when you start or leave a room

# 0.1.10

- Choose the visible part of your profile picture and background, with zoom
- Recommended size for your own background, with a hint for small images
- Videos as profile picture and background work more reliably

# 0.1.9

- Your own profile colour with a colour picker
- Profile picture as GIF or short video
- Your own profile background: image, GIF or video
- Name gradient easier to see, with your own second colour

# 0.1.8

- New theme Aeris with wind and gusts
- Volume is restored on start
- Less background load, especially minimised and in the tray
- New profile effects: veil and lights, all effects reworked
- New frames: Prism and Orbit, accent and glow reworked
- Effects and frames with a live preview in the editor
- Friends and profiles with gentle animations
- New backgrounds: Midnight and Candy, all backgrounds reworked
- Nicer role badges and role rings
- New theme Deep Sea with jellyfish, light play and plankton that reacts to the music
- Theme Amber removed (anyone using it gets Luft Dark)
