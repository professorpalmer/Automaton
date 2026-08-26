#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <mach-o/dyld.h>

/* Window process must live inside Automaton.app. Exec of PATH bun is a Dock CLI icon. */

static int join_path(char *out, size_t cap, const char *a, const char *b) {
  int n = snprintf(out, cap, "%s/%s", a, b);
  return n < 0 || (size_t)n >= cap;
}

int main(void) {
  char exe[PATH_MAX];
  uint32_t size = sizeof(exe);
  if (_NSGetExecutablePath(exe, &size) != 0) {
    fprintf(stderr, "Automaton: cannot read executable path.\n");
    return 1;
  }
  char resolved[PATH_MAX];
  if (!realpath(exe, resolved)) {
    perror("Automaton");
    return 1;
  }

  char macos[PATH_MAX];
  if (strlen(resolved) >= sizeof(macos)) return 1;
  memcpy(macos, resolved, strlen(resolved) + 1);
  char *slash = strrchr(macos, '/');
  if (!slash) return 1;
  *slash = 0;

  char bun[PATH_MAX];
  if (join_path(bun, sizeof(bun), macos, "runtime")) return 1;

  char root_rel[PATH_MAX];
  if (join_path(root_rel, sizeof(root_rel), macos, "../../../..")) return 1;
  char root[PATH_MAX];
  if (!realpath(root_rel, root)) {
    perror("Automaton repo");
    return 1;
  }
  if (chdir(root) != 0) {
    perror("Automaton chdir");
    return 1;
  }

  char entry[PATH_MAX];
  if (join_path(entry, sizeof(entry), root, "src/main.tsx")) return 1;
  if (access(entry, R_OK) != 0) {
    fprintf(stderr, "Automaton: missing %s\n", entry);
    return 1;
  }
  if (access(bun, X_OK) != 0) {
    fprintf(stderr, "Automaton: missing in-bundle bun. Run bun run app from the repo.\n");
    return 1;
  }

  char *args[] = { "Automaton", entry, NULL };
  execv(bun, args);
  perror("Automaton exec");
  return 1;
}
