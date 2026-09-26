package com.relay.receiver.shizuku;

// Runs in the Shizuku (shell uid) process. See ShellService.kt.
interface IShellService {
    // Transaction code Shizuku uses to tear the service down.
    void destroy() = 16777114;

    // Runs one argv (no shell parsing) and returns "exitCode\n" + combined output.
    String run(in String[] argv) = 1;
}
