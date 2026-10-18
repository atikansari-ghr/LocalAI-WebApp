# Private activation review corrections

The independent review of d233ecc..6f2031a found two Important qualification gaps. Activation remains blocked until native verification of these corrections passes.

The environment identity now includes a deterministic hash of the extracted llama.cpp runtime tree: executable/library bytes, file modes and bounded internal symbolic links. The archived download hash alone is insufficient. Ordinary extracted-file drift invalidates the same qualification candidate before activation publication and on gateway bootstrap. Runtime parent directories use the existing `localai-runtime` group so the gateway can read vendor binaries for verification; model files remain restricted to the inference account and protected qualification reports remain root-only.

Activation rejects effective worker/slice drop-ins and alternate unit fragments before publication, then verifies effective execution arguments, socket/runtime directory permissions, user/group, namespace settings and aggregate/per-worker CPU, memory and zero-swap ceilings before committing its journal. Gateway bootstrap also rejects unexpected effective drop-ins. No override or force option is provided.

Regression coverage includes extracted executable/library changes, alternate fragments, unexpected drop-ins, and unlimited swap. The disposable native loader fixture temporarily changes a vendor license file and installs a conflicting inactive-worker drop-in, confirms rejection, and restores both in finally blocks. It never publishes a live activation record or touches enrolled account data.

The 6f2031a native qualification stopped at its isolated recovery fixture: inherited umask077 removed group access from synthetic gateway files. Reproducing the same restrictive umask confirmed the failure. The fixture now explicitly applies its intended group-readable modes; the enrolled gateway was unaffected. This failed qualification is retained as failed evidence, not accepted or bypassed.

Local Windows verification: 109 tests, 106 passed, three POSIX-only skips, zero failures. Documentation checks pass. Clean-source Debian qualification and real activation acceptance remain pending for this revision.
