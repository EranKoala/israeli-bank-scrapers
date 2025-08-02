export declare class TimeoutError extends Error {
}
export declare const SECOND = 1000;
/**
 * Wait until a promise resolves with a truthy value or reject after a timeout
 */
export declare function waitUntil<T>(asyncTest: () => Promise<T>, description?: string, timeout?: number, interval?: number): Promise<T>;
export declare function raceTimeout(ms: number, promise: Promise<any>): Promise<any>;
export declare function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]>;
export declare function sleep(ms: number): Promise<unknown>;
