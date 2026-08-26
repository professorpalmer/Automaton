FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    xdotool \
    x11-apps \
    x11-utils \
    x11-xserver-utils \
    netpbm \
    fluxbox \
    fonts-liberation \
    procps \
    dbus-x11 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1000 box
COPY screen.sh /usr/local/bin/automaton-screen
COPY chromium-policy.json /etc/chromium/policies/managed/automaton.json
RUN chmod 755 /usr/local/bin/automaton-screen
USER box
WORKDIR /home/box
ENV HOME=/home/box
ENTRYPOINT ["sleep", "infinity"]
