# syntax=docker/dockerfile:1
# The bundle files of one release (compose files, scripts, nginx pieces),
# shipped as an image so update.sh takes them from the same signed release
# as the app images (ADR 0007). Context: deploy/self-hosted.
FROM scratch
COPY compose.yaml compose.release.yaml init.sh update.sh .env.example /bundle/
COPY certbot /bundle/certbot
COPY nginx /bundle/nginx
COPY images /bundle/images
COPY migrate /bundle/migrate
# Never run: update.sh only creates a container to copy /bundle out.
CMD ["/bundle"]
