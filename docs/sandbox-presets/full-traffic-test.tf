# Stack Attack — Full Traffic Test (Edge Router)
# This topology demonstrates content-aware routing with all traffic types.

resource "stackattack_edge_router" "router1" {
  label = "Edge Router"
}

resource "stackattack_cdn" "cdn1" {
  label = "CDN"
}

resource "stackattack_streaming_server" "ss1" {
  label = "Streaming Server"
}

resource "stackattack_api_gateway" "ag1" {
  label = "API Gateway"
}

resource "stackattack_blob_storage" "blob1" {
  label = "Blob Storage"
}

resource "stackattack_load_balancer" "lb1" {
  label = "Load Balancer"
}

resource "stackattack_server" "srv1" {
  label = "Server 1"
}

resource "stackattack_server" "srv2" {
  label = "Server 2"
}

resource "stackattack_data_cache" "dc1" {
  label = "Data Cache"
}

resource "stackattack_database" "db1" {
  label = "Database"
}

# Connections — edge router fans out by content type
connection "router1_to_cdn1" {
  from = stackattack_edge_router.router1
  to   = stackattack_cdn.cdn1
}

connection "router1_to_ss1" {
  from = stackattack_edge_router.router1
  to   = stackattack_streaming_server.ss1
}

connection "router1_to_ag1" {
  from = stackattack_edge_router.router1
  to   = stackattack_api_gateway.ag1
}

# CDN and API Gateway converge to Load Balancer
connection "cdn1_to_lb1" {
  from = stackattack_cdn.cdn1
  to   = stackattack_load_balancer.lb1
}

connection "ag1_to_lb1" {
  from = stackattack_api_gateway.ag1
  to   = stackattack_load_balancer.lb1
}

# Load Balancer fans out to servers
connection "lb1_to_srv1" {
  from = stackattack_load_balancer.lb1
  to   = stackattack_server.srv1
}

connection "lb1_to_srv2" {
  from = stackattack_load_balancer.lb1
  to   = stackattack_server.srv2
}

# Servers converge to Data Cache
connection "srv1_to_dc1" {
  from = stackattack_server.srv1
  to   = stackattack_data_cache.dc1
}

connection "srv2_to_dc1" {
  from = stackattack_server.srv2
  to   = stackattack_data_cache.dc1
}

# Data Cache to Database
connection "dc1_to_db1" {
  from = stackattack_data_cache.dc1
  to   = stackattack_database.db1
}

# Streaming Server to Blob Storage
connection "ss1_to_blob1" {
  from = stackattack_streaming_server.ss1
  to   = stackattack_blob_storage.blob1
}

# Traffic configuration
traffic {
  intensity = 80

  composition {
    write  = 10
    auth   = 15
    stream = 20
    large  = 25
    async  = 0
  }

  key_distribution {
    kind       = "zipf"
    alpha      = 1.3
    space_size = 200
  }
}
