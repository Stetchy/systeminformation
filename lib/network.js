'use strict';
// @ts-check
// ==================================================================================
// network.js
// ----------------------------------------------------------------------------------
// Description:   System Information - library
//                for Node.js
// Copyright:     (c) 2014 - 2019
// Author:        Sebastian Hildebrandt
// ----------------------------------------------------------------------------------
// License:       MIT
// ==================================================================================
// 9. Network
// ----------------------------------------------------------------------------------

const os = require('os');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const fs = require('fs');
const util = require('./util');

let _platform = process.platform;

const _linux = (_platform === 'linux');
const _darwin = (_platform === 'darwin');
const _windows = (_platform === 'win32');
const _freebsd = (_platform === 'freebsd');
const _openbsd = (_platform === 'openbsd');
const _netbsd = (_platform === 'netbsd');
const _sunos = (_platform === 'sunos');

let _network = {};
let _default_iface = '';
let _ifaces = [];
let _networkInterfaces = [];
let _mac = {};
let pathToIp;

function getDefaultNetworkInterface() {

  let ifaces = os.networkInterfaces();
  let ifacename = '';
  let ifacenameFirst = '';

  let scopeid = 9999;

  // fallback - "first" external interface (sorted by scopeid)
  for (let dev in ifaces) {
    if (ifaces.hasOwnProperty(dev)) {
      ifaces[dev].forEach(function (details) {
        if (details && details.internal === false) {
          ifacenameFirst = ifacenameFirst || dev; // fallback if no scopeid
          if (details.scopeid && details.scopeid < scopeid) {
            ifacename = dev;
            scopeid = details.scopeid;
          }
        }
      });
    }
  }
  ifacename = ifacename || ifacenameFirst || '';
  if (_linux || _darwin || _freebsd || _openbsd || _netbsd || _sunos) {
    let cmd = '';
    if (_linux) cmd = 'ip route 2> /dev/null | grep default | awk \'{print $5}\'';
    if (_darwin) cmd = 'route get 0.0.0.0 2>/dev/null | grep interface: | awk \'{print $2}\'';
    if (_freebsd || _openbsd || _netbsd || _sunos) cmd = 'route get 0.0.0.0 | grep interface:';
    let result = execSync(cmd);
    ifacename = result.toString().split('\n')[0];
    if (ifacename.indexOf(':') > -1) {
      ifacename = ifacename.split(':')[1].trim();
    }
  }

  if (ifacename) _default_iface = ifacename;
  return _default_iface;
}

exports.getDefaultNetworkInterface = getDefaultNetworkInterface;

function getMacAddresses() {
  let iface = '';
  let mac = '';
  let result = {};
  if (_linux || _freebsd || _openbsd || _netbsd) {
    if (typeof pathToIp === 'undefined') {
      try {
        const lines = execSync('which ip').toString().split('\n');
        if (lines.length && lines[0].indexOf(':') === -1 && lines[0].indexOf('/') === 0) {
          pathToIp = lines[0];
        } else {
          pathToIp = '';
        }
      } catch (e) {
        pathToIp = '';
      }
    }
    const cmd = 'export LC_ALL=C; ' + ((pathToIp) ? pathToIp + ' link show up' : '/sbin/ifconfig') + '; unset LC_ALL';
    let res = execSync(cmd);
    const lines = res.toString().split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] && lines[i][0] !== ' ') {
        if (pathToIp) {
          let nextline = lines[i + 1].trim().split(' ');
          if (nextline[0] === 'link/ether') {
            iface = lines[i].split(' ')[1];
            iface = iface.slice(0, iface.length - 1);
            mac = nextline[1];
          }
        } else {
          iface = lines[i].split(' ')[0];
          mac = lines[i].split('HWaddr ')[1];
        }

        if (iface && mac) {
          result[iface] = mac.trim();
          iface = '';
          mac = '';
        }
      }
    }
  }
  if (_darwin) {
    const cmd = '/sbin/ifconfig';
    let res = execSync(cmd);
    const lines = res.toString().split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] && lines[i][0] !== '\t' && lines[i].indexOf(':') > 0) {
        iface = lines[i].split(':')[0];
      } else if (lines[i].indexOf('\tether ') === 0) {
        mac = lines[i].split('\tether ')[1];
        if (iface && mac) {
          result[iface] = mac.trim();
          iface = '';
          mac = '';
        }
      }
    }
  }
  return result;
}

function networkInterfaceDefault(callback) {

  return new Promise((resolve) => {
    process.nextTick(() => {
      let result = getDefaultNetworkInterface();
      if (callback) { callback(result); }
      resolve(result);
    });
  });
}

exports.networkInterfaceDefault = networkInterfaceDefault;

// --------------------------
// NET - interfaces

function parseLinesWindowsNics(sections) {
  let nics = [];
  for (let i in sections) {
    if (sections.hasOwnProperty(i)) {
      if (sections[i].trim() !== '') {

        let lines = sections[i].trim().split('\r\n');
        let netEnabled = util.getValue(lines, 'NetEnabled', '=');
        if (netEnabled) {
          const speed = parseInt(util.getValue(lines, 'speed', '=').trim(), 10) / 1000000;
          nics.push({
            mac: util.getValue(lines, 'MACAddress', '=').toLowerCase(),
            name: util.getValue(lines, 'Name', '=').replace(/\]/g, ')').replace(/\[/g, '('),
            netEnabled: netEnabled === 'TRUE',
            speed: isNaN(speed) ? -1 : speed,
            operstate: util.getValue(lines, 'NetConnectionStatus', '=') === '2' ? 'up' : 'down',
            type: util.getValue(lines, 'AdapterTypeID', '=') === '9' ? 'wireless' : 'wired'
          });
        }
      }
    }
  }
  return nics;
}

function getWindowsNics() {
  const cmd = util.getWmic() + ' nic get MACAddress, name, NetEnabled, Speed, NetConnectionStatus, AdapterTypeId /value';
  try {
    const nsections = execSync(cmd, util.execOptsWin).split(/\n\s*\n/);
    return (parseLinesWindowsNics(nsections));
  } catch (e) {
    return [];
  }
}

function splitSectionsNics(lines) {
  const result = [];
  let section = [];
  lines.forEach(function (line) {
    if (!line.startsWith('\t')) {
      if (section.length) {
        result.push(section);
        section = [];
      }
    }
    section.push(line);
  });
  if (section.length) {
    result.push(section);
  }
  return result;
}

function parseLinesDarwinNics(sections) {
  let nics = [];
  sections.forEach(section => {
    let nic = {
      iface: '',
      mtu: -1,
      mac: '',
      speed: -1,
      type: '',
      operstate: '',
      duplex: '',
    };
    const first = section[0];
    nic.iface = first.split(':')[0].trim();
    let parts = first.split('> mtu');
    nic.mtu = parts.length > 1 ? parseInt(parts[1], 10) : -1;
    if (isNaN(nic.mtu)) {
      nic.mtu = -1;
    }
    section.forEach(line => {
      if (line.trim().startsWith('ether ')) {
        nic.mac = line.split('ether ')[1].toLowerCase();
      }
    });
    let speed = util.getValue(section, 'link rate');
    nic.speed = speed ? parseFloat(speed) : -1;
    if (nic.speed === -1) {
      speed = util.getValue(section, 'uplink rate');
      nic.speed = speed ? parseFloat(speed) : -1;
      if (nic.speed > -1 && speed.toLowerCase().indexOf('gbps') >= 0) {
        nic.speed = nic.speed * 1000;
      }
    } else {
      if (speed.toLowerCase().indexOf('gbps') >= 0) {
        nic.speed = nic.speed * 1000;
      }
    }
    nic.type = util.getValue(section, 'type').toLowerCase().indexOf('wi-fi') > -1 ? 'wireless' : 'wired';
    nic.operstate = util.getValue(section, 'status').toLowerCase().indexOf('active') > -1 ? 'up' : 'down';
    nic.duplex = util.getValue(section, 'media').toLowerCase().indexOf('half-duplex') > -1 ? 'half' : 'full';
    nics.push(nic);
  });
  return nics;
}

function getDarwinNics() {
  const cmd = 'ifconfig -v';
  try {
    const lines = execSync(cmd, util.execOptsWin).toString().split('\n');
    const nsections = splitSectionsNics(lines);
    return (parseLinesDarwinNics(nsections));
  } catch (e) {
    return [];
  }
}


function networkInterfaces(callback) {

  return new Promise((resolve) => {
    process.nextTick(() => {
      let ifaces = os.networkInterfaces();
      let result = [];
      let nics = [];
      if (JSON.stringify(ifaces) === JSON.stringify(_ifaces)) {
        // no changes - just return object
        result = _networkInterfaces;

        if (callback) { callback(result); }
        resolve(result);
      } else {
        _ifaces = ifaces;
        if (_windows) {
          nics = getWindowsNics();
        }
        if (_darwin) {
          nics = getDarwinNics();
        }
        for (let dev in ifaces) {
          let ip4 = '';
          let ip6 = '';
          let mac = '';
          let duplex = '';
          let mtu = '';
          let speed = -1;
          let carrierChanges = 0;
          let operstate = 'down';
          let type = '';

          if (ifaces.hasOwnProperty(dev)) {
            let ifaceName = dev;
            ifaces[dev].forEach(function (details) {

              if (details.family === 'IPv4') {
                ip4 = details.address;
              }
              if (details.family === 'IPv6') {
                if (!ip6 || ip6.match(/^fe80::/i)) {
                  ip6 = details.address;
                }
              }
              mac = details.mac;
              // fallback due to https://github.com/nodejs/node/issues/13581 (node 8.1 - node 8.2)
              if (mac.indexOf('00:00:0') > -1 && (_linux || _darwin)) {
                if (Object.keys(_mac).length === 0) {
                  _mac = getMacAddresses();
                }
                mac = _mac[dev] || '';
              }
            });
            if (_linux) {
              let iface = dev.split(':')[0].trim().toLowerCase();
              const cmd = `echo -n "addr_assign_type: "; cat /sys/class/net/${iface}/addr_assign_type 2>/dev/null; echo;
            echo -n "address: "; cat /sys/class/net/${iface}/address 2>/dev/null; echo;
            echo -n "addr_len: "; cat /sys/class/net/${iface}/addr_len 2>/dev/null; echo;
            echo -n "broadcast: "; cat /sys/class/net/${iface}/broadcast 2>/dev/null; echo;
            echo -n "carrier: "; cat /sys/class/net/${iface}/carrier 2>/dev/null; echo;
            echo -n "carrier_changes: "; cat /sys/class/net/${iface}/carrier_changes 2>/dev/null; echo;
            echo -n "dev_id: "; cat /sys/class/net/${iface}/dev_id 2>/dev/null; echo;
            echo -n "dev_port: "; cat /sys/class/net/${iface}/dev_port 2>/dev/null; echo;
            echo -n "dormant: "; cat /sys/class/net/${iface}/dormant 2>/dev/null; echo;
            echo -n "duplex: "; cat /sys/class/net/${iface}/duplex 2>/dev/null; echo;
            echo -n "flags: "; cat /sys/class/net/${iface}/flags 2>/dev/null; echo;
            echo -n "gro_flush_timeout: "; cat /sys/class/net/${iface}/gro_flush_timeout 2>/dev/null; echo;
            echo -n "ifalias: "; cat /sys/class/net/${iface}/ifalias 2>/dev/null; echo;
            echo -n "ifindex: "; cat /sys/class/net/${iface}/ifindex 2>/dev/null; echo;
            echo -n "iflink: "; cat /sys/class/net/${iface}/iflink 2>/dev/null; echo;
            echo -n "link_mode: "; cat /sys/class/net/${iface}/link_mode 2>/dev/null; echo;
            echo -n "mtu: "; cat /sys/class/net/${iface}/mtu 2>/dev/null; echo;
            echo -n "netdev_group: "; cat /sys/class/net/${iface}/netdev_group 2>/dev/null; echo;
            echo -n "operstate: "; cat /sys/class/net/${iface}/operstate 2>/dev/null; echo;
            echo -n "proto_down: "; cat /sys/class/net/${iface}/proto_down 2>/dev/null; echo;
            echo -n "speed: "; cat /sys/class/net/${iface}/speed 2>/dev/null; echo;
            echo -n "tx_queue_len: "; cat /sys/class/net/${iface}/tx_queue_len 2>/dev/null; echo;
            echo -n "type: "; cat /sys/class/net/${iface}/type 2>/dev/null; echo;
            echo -n "wireless: "; cat /proc/net/wireless 2>/dev/null \| grep ${iface}; echo
            echo -n "wirelessspeed: "; iw dev ${iface} link 2>&1 \| grep bitrate; echo;`;
              let lines = [];
              try {
                lines = execSync(cmd).toString().split('\n');
              } catch (e) {
                util.noop();
              }
              duplex = util.getValue(lines, 'duplex');
              duplex = duplex.startsWith('cat') ? '' : duplex;
              mtu = parseInt(util.getValue(lines, 'mtu'), 10);
              let myspeed = parseInt(util.getValue(lines, 'speed'), 10);
              speed = isNaN(myspeed) ? -1 : myspeed;
              let wirelessspeed = util.getValue(lines, 'wirelessspeed').split('tx bitrate: ');
              if (speed === -1 && wirelessspeed.length === 2) {
                myspeed = parseFloat(wirelessspeed[1]);
                speed = isNaN(myspeed) ? -1 : myspeed;
              }
              carrierChanges = parseInt(util.getValue(lines, 'carrier_changes'), 10);
              operstate = util.getValue(lines, 'operstate');
              type = operstate === 'up' ? (util.getValue(lines, 'wireless').trim() ? 'wireless' : 'wired') : 'unknown';
              if (iface === 'lo' || iface.startsWith('bond')) { type = 'virtual'; }
              // rx_bytes = parseInt(util.getValue(lines, 'rx_bytes'), 10);
              // rx_dropped = parseInt(util.getValue(lines, 'rx_dropped'), 10);
              // rx_errors = parseInt(util.getValue(lines, 'rx_errors'), 10);
              // tx_bytes = parseInt(util.getValue(lines, 'tx_bytes'), 10);
              // tx_dropped = parseInt(util.getValue(lines, 'tx_dropped'), 10);
              // tx_errors = parseInt(util.getValue(lines, 'tx_errors'), 10);
            }
            if (_windows) {
              nics.forEach(detail => {
                if (detail.mac === mac) {
                  ifaceName = detail.name;
                  operstate = detail.operstate;
                  speed = detail.speed;
                  type = detail.type;
                }
              });
              if (dev.toLowerCase().indexOf('wlan') >= 0 || ifaceName.toLowerCase().indexOf('wlan') >= 0 || ifaceName.toLowerCase().indexOf('wireless') >= 0) {
                type = 'wireless';
              }
            }
            if (_darwin || _freebsd || _openbsd || _netbsd) {
              nics.forEach(nic => {
                if (nic.iface === dev) {
                  mtu = nic.mtu;
                  duplex = nic.duplex;
                  speed = nic.speed;
                  type = nic.type;
                  operstate = nic.operstate;
                }
              });
            }
            let internal = (ifaces[dev] && ifaces[dev][0]) ? ifaces[dev][0].internal : null;
            result.push({
              iface: dev,
              ifaceName,
              ip4,
              ip6,
              mac,
              internal,
              operstate,
              type,
              duplex,
              mtu,
              speed,
              carrierChanges,
            });
          }
        }
        _networkInterfaces = result;
        if (callback) { callback(result); }
        resolve(result);
      }
    });
  });
}

exports.networkInterfaces = networkInterfaces;

// --------------------------
// NET - Speed

function calcNetworkSpeed(iface, rx_bytes, tx_bytes, operstate, rx_dropped, rx_errors, tx_dropped, tx_errors) {
  let result = {
    iface,
    operstate,
    rx_bytes,
    rx_dropped,
    rx_errors,
    tx_bytes,
    tx_dropped,
    tx_errors,
    rx_sec: -1,
    tx_sec: -1,
    ms: 0
  };

  if (_network[iface] && _network[iface].ms) {
    result.ms = Date.now() - _network[iface].ms;
    result.rx_sec = (rx_bytes - _network[iface].rx_bytes) >= 0 ? (rx_bytes - _network[iface].rx_bytes) / (result.ms / 1000) : 0;
    result.tx_sec = (tx_bytes - _network[iface].tx_bytes) >= 0 ? (tx_bytes - _network[iface].tx_bytes) / (result.ms / 1000) : 0;
    _network[iface].rx_bytes = rx_bytes;
    _network[iface].tx_bytes = tx_bytes;
    _network[iface].rx_sec = result.rx_sec;
    _network[iface].tx_sec = result.tx_sec;
    _network[iface].ms = Date.now();
    _network[iface].last_ms = result.ms;
    _network[iface].operstate = operstate;
  } else {
    if (!_network[iface]) _network[iface] = {};
    _network[iface].rx_bytes = rx_bytes;
    _network[iface].tx_bytes = tx_bytes;
    _network[iface].rx_sec = -1;
    _network[iface].tx_sec = -1;
    _network[iface].ms = Date.now();
    _network[iface].last_ms = 0;
    _network[iface].operstate = operstate;
  }
  return result;
}

function networkStats(ifaces, callback) {

  let ifacesArray = [];
  // fallback - if only callback is given
  if (util.isFunction(ifaces) && !callback) {
    callback = ifaces;
    ifacesArray = [getDefaultNetworkInterface()];
  } else {
    ifaces = ifaces || getDefaultNetworkInterface();
    ifaces = ifaces.trim().toLowerCase().replace(/,+/g, '|');
    ifacesArray = ifaces.split('|');
  }

  return new Promise((resolve) => {
    process.nextTick(() => {

      const result = [];

      const workload = [];
      if (ifacesArray.length && ifacesArray[0].trim() === '*') {
        ifacesArray = [];
        networkInterfaces().then(allIFaces => {
          for (let iface of allIFaces) {
            ifacesArray.push(iface.iface);
          }
          networkStats(ifacesArray.join(',')).then(result => {
            if (callback) { callback(result); }
            resolve(result);
          });
        });
      } else {
        for (let iface of ifacesArray) {
          workload.push(networkStatsSingle(iface.trim()));
        }
        if (workload.length) {
          Promise.all(
            workload
          ).then(data => {
            if (callback) { callback(data); }
            resolve(data);
          });
        } else {
          if (callback) { callback(result); }
          resolve(result);
        }
      }
    });
  });
}

function networkStatsSingle(iface) {

  function parseLinesWindowsPerfData(sections) {
    let perfData = [];
    for (let i in sections) {
      if (sections.hasOwnProperty(i)) {
        if (sections[i].trim() !== '') {

          let lines = sections[i].trim().split('\r\n');
          perfData.push({
            name: util.getValue(lines, 'Name', '=').replace(/[()\[\] ]+/g, '').toLowerCase(),
            rx_bytes: parseInt(util.getValue(lines, 'BytesReceivedPersec', '='), 10),
            rx_errors: parseInt(util.getValue(lines, 'PacketsReceivedErrors', '='), 10),
            rx_dropped: parseInt(util.getValue(lines, 'PacketsReceivedDiscarded', '='), 10),
            tx_bytes: parseInt(util.getValue(lines, 'BytesSentPersec', '='), 10),
            tx_errors: parseInt(util.getValue(lines, 'PacketsOutboundErrors', '='), 10),
            tx_dropped: parseInt(util.getValue(lines, 'PacketsOutboundDiscarded', '='), 10)
          });
        }
      }
    }
    return perfData;
  }

  return new Promise((resolve) => {
    process.nextTick(() => {

      let result = {
        iface: iface,
        operstate: 'unknown',
        rx_bytes: 0,
        rx_dropped: 0,
        rx_errors: 0,
        tx_bytes: 0,
        tx_dropped: 0,
        tx_errors: 0,
        rx_sec: -1,
        tx_sec: -1,
        ms: 0
      };

      let operstate = 'unknown';
      let rx_bytes = 0;
      let tx_bytes = 0;
      let rx_dropped = 0;
      let rx_errors = 0;
      let tx_dropped = 0;
      let tx_errors = 0;

      let cmd, lines, stats;
      if (!_network[iface] || (_network[iface] && !_network[iface].ms) || (_network[iface] && _network[iface].ms && Date.now() - _network[iface].ms >= 500)) {
        if (_linux) {
          if (fs.existsSync('/sys/class/net/' + iface)) {
            cmd =
              'cat /sys/class/net/' + iface + '/operstate; ' +
              'cat /sys/class/net/' + iface + '/statistics/rx_bytes; ' +
              'cat /sys/class/net/' + iface + '/statistics/tx_bytes; ' +
              'cat /sys/class/net/' + iface + '/statistics/rx_dropped; ' +
              'cat /sys/class/net/' + iface + '/statistics/rx_errors; ' +
              'cat /sys/class/net/' + iface + '/statistics/rx_dropped; ' +
              'cat /sys/class/net/' + iface + '/statistics/tx_errors; ';
            exec(cmd, function (error, stdout) {
              if (!error) {
                lines = stdout.toString().split('\n');
                operstate = lines[0].trim();
                rx_bytes = parseInt(lines[1], 10);
                tx_bytes = parseInt(lines[2], 10);
                rx_dropped = parseInt(lines[3], 10);
                rx_errors = parseInt(lines[4], 10);
                tx_dropped = parseInt(lines[5], 10);
                tx_errors = parseInt(lines[6], 10);

                result = calcNetworkSpeed(iface, rx_bytes, tx_bytes, operstate, rx_dropped, rx_errors, tx_dropped, tx_errors);

              }
              resolve(result);
            });
          } else {
            resolve(result);
          }
        }
        if (_freebsd || _openbsd || _netbsd) {
          cmd = 'netstat -ibndI ' + iface;
          exec(cmd, function (error, stdout) {
            if (!error) {
              lines = stdout.toString().split('\n');
              for (let i = 1; i < lines.length; i++) {
                const line = lines[i].replace(/ +/g, ' ').split(' ');
                if (line && line[0] && line[7] && line[10]) {
                  rx_bytes = rx_bytes + parseInt(line[7]);
                  if (stats[6].trim() !== '-') { rx_dropped = rx_dropped + parseInt(stats[6]); }
                  if (stats[5].trim() !== '-') { rx_errors = rx_errors + parseInt(stats[5]); }
                  tx_bytes = tx_bytes + parseInt(line[10]);
                  if (stats[12].trim() !== '-') { tx_dropped = tx_dropped + parseInt(stats[12]); }
                  if (stats[9].trim() !== '-') { tx_errors = tx_errors + parseInt(stats[9]); }
                  operstate = 'up';
                }
              }
              result = calcNetworkSpeed(iface, rx_bytes, tx_bytes, operstate, rx_dropped, rx_errors, tx_dropped, tx_errors);
            }
            resolve(result);
          });
        }
        if (_darwin) {
          cmd = 'ifconfig ' + iface + ' | grep "status"';
          exec(cmd, function (error, stdout) {
            result.operstate = (stdout.toString().split(':')[1] || '').trim();
            result.operstate = (result.operstate || '').toLowerCase();
            result.operstate = (result.operstate === 'active' ? 'up' : (result.operstate === 'inactive' ? 'down' : 'unknown'));
            cmd = 'netstat -bdI ' + iface;
            exec(cmd, function (error, stdout) {
              if (!error) {
                lines = stdout.toString().split('\n');
                // if there is less than 2 lines, no information for this interface was found
                if (lines.length > 1 && lines[1].trim() !== '') {
                  // skip header line
                  // use the second line because it is tied to the NIC instead of the ipv4 or ipv6 address
                  stats = lines[1].replace(/ +/g, ' ').split(' ');
                  rx_bytes = parseInt(stats[6]);
                  rx_dropped = parseInt(stats[11]);
                  rx_errors = parseInt(stats[5]);
                  tx_bytes = parseInt(stats[9]);
                  tx_dropped = parseInt(stats[11]);
                  tx_errors = parseInt(stats[8]);

                  result = calcNetworkSpeed(iface, rx_bytes, tx_bytes, result.operstate, rx_dropped, rx_errors, tx_dropped, tx_errors);
                }
              }
              resolve(result);
            });
          });
        }
        if (_windows) {
          let perfData = [];
          let ifaceName = iface;

          // Performance Data
          util.wmic('path Win32_PerfRawData_Tcpip_NetworkInterface Get name,BytesReceivedPersec,BytesSentPersec,BytesTotalPersec,PacketsOutboundDiscarded,PacketsOutboundErrors,PacketsReceivedDiscarded,PacketsReceivedErrors /value').then((stdout, error) => {
            if (!error) {
              const psections = stdout.toString().split(/\n\s*\n/);
              perfData = parseLinesWindowsPerfData(psections);
            }

            // Network Interfaces
            networkInterfaces().then(interfaces => {
              // get bytes sent, received from perfData by name
              rx_bytes = 0;
              tx_bytes = 0;
              perfData.forEach(detail => {
                interfaces.forEach(det => {
                  if ((det.iface.toLowerCase() === iface.toLowerCase() || det.mac.toLowerCase() === iface.toLowerCase() || det.ip4.toLowerCase() === iface.toLowerCase() || det.ip6.toLowerCase() === iface.toLowerCase() || (det.ifaceName.replace(/[()\[\] ]+/g, '').toLowerCase() === iface.replace(/[()\[\] ]+/g, '').toLowerCase()) && det.ifaceName.replace(/[()\[\] ]+/g, '').toLowerCase() === detail.name)) {
                    ifaceName = det.iface;
                    rx_bytes = detail.rx_bytes;
                    rx_dropped = detail.rx_dropped;
                    rx_errors = detail.rx_errors;
                    tx_bytes = detail.tx_bytes;
                    tx_dropped = detail.tx_dropped;
                    tx_errors = detail.tx_errors;
                    operstate = det.operstate;
                  }
                });
              });

              if (rx_bytes && tx_bytes) {
                result = calcNetworkSpeed(ifaceName, parseInt(rx_bytes), parseInt(tx_bytes), operstate, rx_dropped, rx_errors, tx_dropped, tx_errors);
              }
              resolve(result);
            });
          });
        }
      } else {
        result.rx_bytes = _network[iface].rx_bytes;
        result.tx_bytes = _network[iface].tx_bytes;
        result.rx_sec = _network[iface].rx_sec;
        result.tx_sec = _network[iface].tx_sec;
        result.ms = _network[iface].last_ms;
        result.operstate = _network[iface].operstate;
        resolve(result);
      }
    });
  });
}

exports.networkStats = networkStats;

// --------------------------
// NET - connections (sockets)

function networkConnections(callback) {

  return new Promise((resolve) => {
    process.nextTick(() => {
      let result = [];
      if (_linux || _freebsd || _openbsd || _netbsd) {
        let cmd = 'netstat -tuna | grep "ESTABLISHED\\|SYN_SENT\\|SYN_RECV\\|FIN_WAIT1\\|FIN_WAIT2\\|TIME_WAIT\\|CLOSE\\|CLOSE_WAIT\\|LAST_ACK\\|LISTEN\\|CLOSING\\|UNKNOWN\\|VERBUNDEN"';
        if (_freebsd || _openbsd || _netbsd) cmd = 'netstat -na | grep "ESTABLISHED\\|SYN_SENT\\|SYN_RECV\\|FIN_WAIT1\\|FIN_WAIT2\\|TIME_WAIT\\|CLOSE\\|CLOSE_WAIT\\|LAST_ACK\\|LISTEN\\|CLOSING\\|UNKNOWN\\|VERBUNDEN"';
        exec(cmd, { maxBuffer: 1024 * 2000 }, function (error, stdout) {
          if (!error) {
            let lines = stdout.toString().split('\n');
            lines.forEach(function (line) {
              line = line.replace(/ +/g, ' ').split(' ');
              if (line.length >= 6) {
                let localip = line[3];
                let localport = '';
                let localaddress = line[3].split(':');
                if (localaddress.length > 1) {
                  localport = localaddress[localaddress.length - 1];
                  localaddress.pop();
                  localip = localaddress.join(':');
                }
                let peerip = line[4];
                let peerport = '';
                let peeraddress = line[4].split(':');
                if (peeraddress.length > 1) {
                  peerport = peeraddress[peeraddress.length - 1];
                  peeraddress.pop();
                  peerip = peeraddress.join(':');
                }
                let connstate = line[5];
                if (connstate === 'VERBUNDEN') connstate = 'ESTABLISHED';
                if (connstate) {
                  result.push({
                    protocol: line[0],
                    localaddress: localip,
                    localport: localport,
                    peeraddress: peerip,
                    peerport: peerport,
                    state: connstate
                  });
                }
              }
            });
            if (callback) {
              callback(result);
            }
            resolve(result);
          } else {
            cmd = 'ss -tuna | grep "ESTAB\\|SYN-SENT\\|SYN-RECV\\|FIN-WAIT1\\|FIN-WAIT2\\|TIME-WAIT\\|CLOSE\\|CLOSE-WAIT\\|LAST-ACK\\|LISTEN\\|CLOSING"';
            exec(cmd, { maxBuffer: 1024 * 2000 }, function (error, stdout) {

              if (!error) {
                let lines = stdout.toString().split('\n');
                lines.forEach(function (line) {
                  line = line.replace(/ +/g, ' ').split(' ');
                  if (line.length >= 6) {
                    let localip = line[4];
                    let localport = '';
                    let localaddress = line[4].split(':');
                    if (localaddress.length > 1) {
                      localport = localaddress[localaddress.length - 1];
                      localaddress.pop();
                      localip = localaddress.join(':');
                    }
                    let peerip = line[5];
                    let peerport = '';
                    let peeraddress = line[5].split(':');
                    if (peeraddress.length > 1) {
                      peerport = peeraddress[peeraddress.length - 1];
                      peeraddress.pop();
                      peerip = peeraddress.join(':');
                    }
                    let connstate = line[1];
                    if (connstate === 'ESTAB') connstate = 'ESTABLISHED';
                    if (connstate === 'TIME-WAIT') connstate = 'TIME_WAIT';
                    if (connstate) {
                      result.push({
                        protocol: line[0],
                        localaddress: localip,
                        localport: localport,
                        peeraddress: peerip,
                        peerport: peerport,
                        state: connstate
                      });
                    }
                  }
                });
              }
              if (callback) {
                callback(result);
              }
              resolve(result);
            });
          }
        });
      }
      if (_darwin) {
        let cmd = 'netstat -nat | grep "ESTABLISHED\\|SYN_SENT\\|SYN_RECV\\|FIN_WAIT1\\|FIN_WAIT2\\|TIME_WAIT\\|CLOSE\\|CLOSE_WAIT\\|LAST_ACK\\|LISTEN\\|CLOSING\\|UNKNOWN"';
        exec(cmd, { maxBuffer: 1024 * 2000 }, function (error, stdout) {
          if (!error) {

            let lines = stdout.toString().split('\n');

            lines.forEach(function (line) {
              line = line.replace(/ +/g, ' ').split(' ');
              if (line.length >= 6) {
                let localip = line[3];
                let localport = '';
                let localaddress = line[3].split('.');
                if (localaddress.length > 1) {
                  localport = localaddress[localaddress.length - 1];
                  localaddress.pop();
                  localip = localaddress.join('.');
                }
                let peerip = line[4];
                let peerport = '';
                let peeraddress = line[4].split('.');
                if (peeraddress.length > 1) {
                  peerport = peeraddress[peeraddress.length - 1];
                  peeraddress.pop();
                  peerip = peeraddress.join('.');
                }
                let connstate = line[5];
                if (connstate) {
                  result.push({
                    protocol: line[0],
                    localaddress: localip,
                    localport: localport,
                    peeraddress: peerip,
                    peerport: peerport,
                    state: connstate
                  });
                }
              }
            });
            if (callback) {
              callback(result);
            }
            resolve(result);
          }
        });
      }
      if (_windows) {
        let cmd = 'netstat -na';
        try {
          exec(cmd, util.execOptsWin, function (error, stdout) {
            if (!error) {

              let lines = stdout.toString().split('\r\n');

              lines.forEach(function (line) {
                line = line.trim().replace(/ +/g, ' ').split(' ');
                if (line.length >= 4) {
                  let localip = line[1];
                  let localport = '';
                  let localaddress = line[1].split(':');
                  if (localaddress.length > 1) {
                    localport = localaddress[localaddress.length - 1];
                    localaddress.pop();
                    localip = localaddress.join(':');
                  }
                  let peerip = line[2];
                  let peerport = '';
                  let peeraddress = line[2].split(':');
                  if (peeraddress.length > 1) {
                    peerport = peeraddress[peeraddress.length - 1];
                    peeraddress.pop();
                    peerip = peeraddress.join(':');
                  }
                  let connstate = line[3];
                  if (connstate === 'HERGESTELLT') connstate = 'ESTABLISHED';
                  if (connstate.startsWith('ABH')) connstate = 'LISTEN';
                  if (connstate === 'SCHLIESSEN_WARTEN') connstate = 'CLOSE_WAIT';
                  if (connstate === 'WARTEND') connstate = 'TIME_WAIT';
                  if (connstate === 'SYN_GESENDET') connstate = 'SYN_SENT';

                  if (connstate === 'LISTENING') connstate = 'LISTEN';
                  if (connstate === 'SYN_RECEIVED') connstate = 'SYN_RECV';
                  if (connstate === 'FIN_WAIT_1') connstate = 'FIN_WAIT1';
                  if (connstate === 'FIN_WAIT_2') connstate = 'FIN_WAIT2';
                  if (connstate) {
                    result.push({
                      protocol: line[0].toLowerCase(),
                      localaddress: localip,
                      localport: localport,
                      peeraddress: peerip,
                      peerport: peerport,
                      state: connstate
                    });
                  }
                }
              });
              if (callback) {
                callback(result);
              }
              resolve(result);
            }
          });
        } catch (e) {
          if (callback) { callback(result); }
          resolve(result);
        }
      }
    });
  });
}

exports.networkConnections = networkConnections;
