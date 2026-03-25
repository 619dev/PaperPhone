# Client — Nginx static server + reverse proxy to backend
FROM nginx:1.27-alpine
LABEL org.opencontainers.image.title="PaperPhone Client" \
      org.opencontainers.image.description="PaperPhone IM — H5/PWA frontend"

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our nginx config as a template (SERVER_HOST substituted at runtime)
COPY nginx.conf /etc/nginx/conf.d/paperphone.conf.template

# Copy static client files
COPY index.html    /usr/share/nginx/html/
COPY manifest.json /usr/share/nginx/html/
COPY sw.js         /usr/share/nginx/html/
COPY src           /usr/share/nginx/html/src
COPY public        /usr/share/nginx/html/public

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/manifest.json || exit 1

# Substitute ${SERVER_HOST} only (leave nginx's own $variables intact), then start nginx
CMD ["/bin/sh", "-c", \
  "envsubst '${SERVER_HOST}' < /etc/nginx/conf.d/paperphone.conf.template > /etc/nginx/conf.d/paperphone.conf && exec nginx -g 'daemon off;'"]
