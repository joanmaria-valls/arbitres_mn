# Cloudflare Tunnel Configuration Setup Instructions

## Prerequisites
1. A Cloudflare account.
2. Access to the command line on your server.
3. Your domain configured with Cloudflare.

## Steps to Set Up Cloudflare Tunnel

### 1. Install Cloudflare's Tunnel Client (cloudflared)
- Download the latest version of cloudflared from the [Cloudflare GitHub Releases](https://github.com/cloudflare/cloudflared/releases).
- For Debian/Ubuntu:
  ```bash
  sudo apt install cloudflared
  ```
- For Mac:
  ```bash
  brew install cloudflare/cloudflare/cloudflared
  ```

### 2. Authenticate with Cloudflare
- Run the following command to login:
  ```bash
  cloudflared login
  ```
- Follow the prompts to authenticate.

### 3. Create a Tunnel
- Use the command:
  ```bash
  cloudflared tunnel create <TUNNEL_NAME>
  ```
  Replace `<TUNNEL_NAME>` with your desired name.

### 4. Configure the Tunnel
- Create a configuration file (config.yml) in `~/.cloudflared/` with the following structure:
  ```yaml
  tunnel: <TUNNEL_ID>
  credentials-file: /path/to/credentials/file.json
  ingress:
    - hostname: <YOUR_DOMAIN>
      service: http://localhost:<YOUR_SERVICE_PORT>
    - service: http_status:404
  ```
  Replace `<TUNNEL_ID>`, `<YOUR_DOMAIN>`, and `<YOUR_SERVICE_PORT>` accordingly.

### 5. Run the Tunnel
- With the configuration set up, run:
  ```bash
  cloudflared tunnel run <TUNNEL_NAME>
  ```

### 6. Test the Tunnel
- Open a browser and go to `http://<YOUR_DOMAIN>`. You should see your application running.

## Conclusion
- You have successfully set up a Cloudflare Tunnel. For further configurations, refer to the [Cloudflare documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/connecting-apps/)