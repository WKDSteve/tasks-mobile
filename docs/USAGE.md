# Using tasks-mobile on a phone

> **Not yet possible.** This describes how it works once the hub of tasks-desktop serves the page under `/m/`
> ([HUB.md](HUB.md)). Until then nothing here reaches a page.

## 1. The tunnel

The hub on the PC listens on `127.0.0.1` only. The phone reaches it through an SSH tunnel with the **same port on both
ends** (the hub checks `Host` and `Origin`, and both name the port). On Android, for example in Termux:

```
ssh -N -L 17615:127.0.0.1:17615 user@your-pc
```

`17615` is the hub's usual port; `tasks-hub open` on the PC prints the one it runs on. Do not forward the port with
`-g`: whoever can use the local port on the phone can reach the pairing page.

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

The session lasts while the app is open. After it was closed, pair again (a per-device key comes with the hub's
device support).

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

## 5. Disconnect

**Disconnect and delete the data** (at the bottom of **Waiting**, after a question) removes the session, the kept list
and what still waits.
