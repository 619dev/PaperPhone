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
export declare function joinHostPort(host: string, port?: number): string;