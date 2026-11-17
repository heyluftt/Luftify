FROM rust:1.88-bookworm AS builder
WORKDIR /src
COPY . .
RUN cargo build --release -p luft-sync-server

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/luft-sync-server /usr/local/bin/luft-sync-server
ENV PORT=8080
ENV LUFTIFY_SOCIAL_DATABASE=/data/social.sqlite
RUN mkdir -p /data
EXPOSE 8080
CMD ["luft-sync-server"]
