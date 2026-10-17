# Etapa 1: compilación
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_API_MODE=real
ENV VITE_API_MODE=$VITE_API_MODE
RUN npm run build

# Etapa 2: servidor estático sin herramientas de compilación
FROM nginx:1.27-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/conf.d/sicil.conf
COPY nginx/proxy_params_sicil /etc/nginx/proxy_params_sicil
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
