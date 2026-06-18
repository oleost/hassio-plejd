# To specify the base image version, edit build.yaml
# Specifying BUILD_FROM=image:version in this file doesn't work
ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG=C.UTF-8

# Instruct npm to run lifecycle scripts (like preinstall, install, postinstall) 
# as the root user, instead of trying to downgrade permissions.
ENV NPM_CONFIG_UNSAFE_PERM=true

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Copy data for add-on
COPY ./*.js /plejd/
COPY ./config.json /plejd/
COPY ./package.json /plejd/

ARG BUILD_ARCH

# Install Node
# The pinned base image ships musl-1.2.5-r10 with a versioned world pin, but the
# Alpine v3.22 repository has moved on to musl-1.2.5-r12. musl-dev (pulled in by
# libc-dev/g++) requires the exact matching musl version, so apk fails with
# "musl breaks musl-dev". A plain `apk upgrade musl` is a no-op because of the
# version pin; `apk upgrade --available` resets the versioned world dependencies
# and brings every base package up to the current v3.22 repo (incl. musl r12),
# which resolves the conflict without bumping to a newer base image / Alpine.
RUN set -eux; \
  apk --no-cache upgrade --available; \
  apk add --no-cache --virtual .build-dependencies \
  g++ \
  gcc \
  libc-dev \
  linux-headers \
  make \
  python3 \
  bluez \
  eudev-dev \
  zlib-dev \
  \
  && apk add --no-cache \
  git \
  nodejs \
  npm \
  dbus-dev \
  glib-dev

WORKDIR /plejd
RUN npm install \
  --no-audit \
  --no-update-notifier \
  --unsafe-perm

# Copy root filesystem
COPY rootfs /
# Ensure runtime scripts remain executable even if modes were lost in the source checkout
RUN set -eux; \
  chmod 0755 /etc/services.d/plejd/run /etc/cont-init.d/10-plejd-perms /usr/bin/plejd.sh

# Build arguments
ARG BUILD_DATE
ARG BUILD_REF
ARG BUILD_VERSION

# Labels
LABEL \
  io.hass.name="Plejd" \
  io.hass.description="Adds support for the Swedish home automation devices from Plejd." \
  io.hass.arch="${BUILD_ARCH}" \
  io.hass.type="addon" \
  io.hass.version=${BUILD_VERSION} \
  maintainer="oleost <oleprong@gmail.com>" \
  org.label-schema.description="Adds support for the Swedish home automation devices from Plejd." \
  org.label-schema.build-date=${BUILD_DATE} \
  org.label-schema.name="Plejd" \
  org.label-schema.schema-version="1.0" \
  org.label-schema.usage="https://github.com/oleost/hassio-plejd/tree/master/README.md" \
  org.label-schema.vcs-ref=${BUILD_REF} \
  org.label-schema.vcs-url="https://github.com/oleost/hassio-plejd"
