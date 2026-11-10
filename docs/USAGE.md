# Using tasks-mobile on a phone

> Needs a tasks-desktop from its rolling build `latest` on (it serves this page under `/m/`). Tried on an Android phone
> (Chrome, installed as an app) over USB; the SSH tunnel of Termux is not tried yet: tell what does not work as written
> here.

## 1. The tunnel

The hub on the PC listens on `127.0.0.1` only. The phone reaches it through an SSH tunnel with the **same port on both
ends** (the hub checks `Host` and `Origin`, and both name the port). On Android, for example in Termux:

```
ssh -N -L 17615:127.0.0.1:17615 user@your-pc
```

`17615` is the hub's usual port; `tasks-hub open` on the PC prints the one it runs on. Do not forward the port with
`-g`: whoever can use the local port on the phone can reach the pairing page.

Over a USB cable instead, with USB debugging on and `adb` on the PC: `adb reverse tcp:17615 tcp:17615`. A cable that
comes loose takes the forward with it; set it again.

`http://127.0.0.1` counts as a secure origin in Chrome, so the app can be installed and works offline over this tunnel
without a certificate.

## 2. Pairing

On the PC:

```
tasks-hub open
```

It prints `http://127.0.0.1:PORT/#pair=<code>`. Open the same address on the phone with `/m/` in front of the `#`:

```
http://127.0.0.1:PORT/m/#pair=<code>
```

or open `http://127.0.0.1:PORT/m/` and paste the link into the field. The code works once and for a short time.

This is needed **once**: the phone keeps a key of its own and signs in by itself on every start, also after the
PC or the hub restarted. Give the device a name in the field below the code; the PC lists devices by it. When the PC
revokes the device, the app shows the pairing screen again.

## 3. Install

In Chrome on Android: menu > **Install app** (or **Add to home screen**). The app then appears among the targets when
you share a link or a text from another app.

## 4. Offline

Without the tunnel the app shows the last list it read, with the time it is from. What you create or change waits under
**Waiting** and is sent when the hub is reached again (when the app comes to the front, when the phone is online again,
or with **Send now**).

- **waiting**: not sent yet.
- **not known whether it arrived**: it was sent, the answer was lost. Look in the list; drop it if it is there, send it
  again if not.
- **conflict**: the task changed on the PC after you read it. Nothing was overwritten; open the task and change it
  again on the new version.
- **refused**: the hub or the engine said no, with its words.

Attachments of a new task wait with it and are sent after it, to the task the engine made. A file that did not
arrive (refused, or its answer lost) stays under **Waiting** on its own as "attachment ..."; the task is there
already. The phone keeps a file only until the PC took it, and deletes every file when it is disconnected.

The microphone is asked for only when you press **Voice note**, and a recording stops when the app goes to the
background or after five minutes.

## 5. Disconnect

**Disconnect and delete the data** (at the bottom of **Waiting**, after a question) removes the device key, the kept list
and what still waits.
