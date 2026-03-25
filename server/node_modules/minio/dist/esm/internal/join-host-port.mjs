/**
 * joinHostPort combines host and port into a network address of the
 * form "host:port". If host contains a colon, as found in literal
 * IPv6 addresses, then JoinHostPort returns "[host]:port".
 *
 * @param host
 * @param port
 * @returns Cleaned up host
 * @internal
 */
export function joinHostPort(host, port) {
  if (port === undefined) {
    return host;
  }

  // We assume that host is a literal IPv6 address if host has
  // colons.
  if (host.includes(':')) {
    return `[${host}]:${port.toString()}`;
  }
  return `${host}:${port.toString()}`;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJqb2luSG9zdFBvcnQiLCJob3N0IiwicG9ydCIsInVuZGVmaW5lZCIsImluY2x1ZGVzIiwidG9TdHJpbmciXSwic291cmNlcyI6WyJqb2luLWhvc3QtcG9ydC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIGpvaW5Ib3N0UG9ydCBjb21iaW5lcyBob3N0IGFuZCBwb3J0IGludG8gYSBuZXR3b3JrIGFkZHJlc3Mgb2YgdGhlXG4gKiBmb3JtIFwiaG9zdDpwb3J0XCIuIElmIGhvc3QgY29udGFpbnMgYSBjb2xvbiwgYXMgZm91bmQgaW4gbGl0ZXJhbFxuICogSVB2NiBhZGRyZXNzZXMsIHRoZW4gSm9pbkhvc3RQb3J0IHJldHVybnMgXCJbaG9zdF06cG9ydFwiLlxuICpcbiAqIEBwYXJhbSBob3N0XG4gKiBAcGFyYW0gcG9ydFxuICogQHJldHVybnMgQ2xlYW5lZCB1cCBob3N0XG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGpvaW5Ib3N0UG9ydChob3N0OiBzdHJpbmcsIHBvcnQ/OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAocG9ydCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGhvc3RcbiAgfVxuXG4gIC8vIFdlIGFzc3VtZSB0aGF0IGhvc3QgaXMgYSBsaXRlcmFsIElQdjYgYWRkcmVzcyBpZiBob3N0IGhhc1xuICAvLyBjb2xvbnMuXG4gIGlmIChob3N0LmluY2x1ZGVzKCc6JykpIHtcbiAgICByZXR1cm4gYFske2hvc3R9XToke3BvcnQudG9TdHJpbmcoKX1gXG4gIH1cblxuICByZXR1cm4gYCR7aG9zdH06JHtwb3J0LnRvU3RyaW5nKCl9YFxufVxuIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE9BQU8sU0FBU0EsWUFBWUEsQ0FBQ0MsSUFBWSxFQUFFQyxJQUFhLEVBQVU7RUFDaEUsSUFBSUEsSUFBSSxLQUFLQyxTQUFTLEVBQUU7SUFDdEIsT0FBT0YsSUFBSTtFQUNiOztFQUVBO0VBQ0E7RUFDQSxJQUFJQSxJQUFJLENBQUNHLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRTtJQUN0QixPQUFRLElBQUdILElBQUssS0FBSUMsSUFBSSxDQUFDRyxRQUFRLENBQUMsQ0FBRSxFQUFDO0VBQ3ZDO0VBRUEsT0FBUSxHQUFFSixJQUFLLElBQUdDLElBQUksQ0FBQ0csUUFBUSxDQUFDLENBQUUsRUFBQztBQUNyQyJ9