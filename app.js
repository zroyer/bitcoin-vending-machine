var CK_API_HOST = 'https://api.coinkite.com';
var CK_API_KEYS = {};

var app = angular.module('cc-example-module', ['mgcrea.ngStrap', 'restangular']);

app.controller('mainController', function($scope, Restangular, $sce, $alert, $timeout)
{
  $scope.real_money = false;
  $scope.rates = {};
  $scope.reload_rates = function() {
    Restangular.one('public/rates').get().then(function(r) {
      console.log("Got rates");
      var rates = r.rates;
      $scope.rates = rates;
    });
  }
  $scope.reload_rates();

  var all_currencies = [
  { code: 'BTC', name: 'Bitcoin', sign: 'Ƀ' },
  { code: 'LTC', name: 'Litecoin', sign: 'Ł' },
  ];
  $scope.currencies = angular.copy(all_currencies)
  $scope.fav_currencies = [ 'USD'];

  $scope.filter_fav_currency = function(pair) {
    return _.contains($scope.fav_currencies, pair.code);
  };

  $scope.possible_bills = [
    { label:'$1 USD', value: { amount: 1, cct: 'USD', sign: '$'}},
    { label:'$5 USD', value: { amount: 5, cct: 'USD', sign: '$'}},
    { label:'$10 USD', value: { amount: 10, cct: 'USD', sign: '$'}},
    { label:'$20 USD', value: { amount: 20, cct: 'USD', sign: '$'}},
    { label:'$50 USD', value: { amount: 50, cct: 'USD', sign: '$'}},
    { label:'$100 USD', value: { amount: 100, cct: 'USD', sign: '$'}}
  ];

  $scope.reset_all = function() {
    $scope.txn = {
      coin_type: null,
      method: null,               // qr, email, sms or address
      dest_address: null,
      dest_email: null,
      dest_phone: null,

      deposit_list: [],
      busy: false,
    };
  };
  $scope.reset_all();

  $scope.$watch('txn.coin_type', function(newVal, oldVal) {
    // They have picked a new currency. Fetch balance for that
    // account?
    if(!newVal) return;
    console.log("new coin type: ", newVal.code);
    // XXX add code here:
    //  - check we have some coins of that type to sell right now (balance)
    //  - setup a limit so they don't deposit more than we can sell.
  });

  $scope.need_qr = function() {
    return $scope.txn.method == 'qr' && !$scope.txn.dest_address;
  };

  $scope.cash_ready = function() {
    // when are we ready to accept bills?
    return $scope.txn.coin_type && $scope.txn.method
    && ($scope.txn.method != 'qr' || $scope.txn.dest_address)
    && ($scope.txn.method != 'email' || $scope.txn.dest_email)
    && ($scope.txn.method != 'sms' || $scope.txn.dest_phone);
  };

  $scope.can_stop = function() {
    // when are we ready to complete the transaction?
    return $scope.cash_ready() && $scope.txn.deposit_list.length;
  };

  $scope.new_address = function(pk) {
    console.log("New key: ", $scope.txn.dest_address);
  };

  $scope.insert_bill = function(bill) {
    for(var i=0; i < $scope.txn.deposit_list.length; i++) {
      var h = $scope.txn.deposit_list[i];
      if(h.cct == bill.value.cct) {
        h.amount += bill.value.amount
        return;
      }
    }
    $scope.txn.deposit_list.push(angular.copy(bill.value));
  };

  $scope.current_quote = function() {
    if(!$scope.txn.coin_type) return;

    var tot = 0;
    var cct = $scope.txn.coin_type.code;
    var lst = $scope.txn.deposit_list;
    var pairs = $scope.rates[cct];

    for(var i=0; i < lst.length; i++) {
      var h = lst[i];
      var ex = pairs[h.cct].rate;
      tot += h.amount / ex;
    }

    if(tot > 1000) {
      tot = tot.toFixed(2);
    } else if(tot > 0.01) {
      tot = tot.toFixed(4);
    }

    return Number(tot).toFixed(8);
  };

  $scope.$on('new_account_list', function(evt, lst) {
    console.log("New acct list!? ", lst);
    $scope.currencies = new Array();
    _.forEach(all_currencies, function(c, idx) {
      var ff = _.find(lst, {coin_type: c.code});
      if(ff) {
        var linkage = angular.copy(c);
        linkage.account = ff.CK_refnum;
        $scope.currencies.push(linkage);
      }
    });
    if(!$scope.currencies.length) {
      alert("No subaccounts linked are useable?");
      $scope.currencies = angular.copy(all_currencies);
      $scope.real_money = false;

      return;
    }
    $scope.real_money = true;
});

$scope.print_and_done = function() {
    var v = angular.element(document.getElementById('proto-txn')).html();
    $scope.last_receipt = $sce.trustAsHtml(v);
    $scope.txn.busy = false;
    $scope.reset_all()
  };

  $scope.show_err = function(resp) {
    // use as a promise.catch handler
    console.log("Failed REST response: ", resp);
    var err = resp.data;
    $alert({title: resp.status + ': ' + err.message,
      content: (err.help_msg || "No extra help, sorry"),
      placement: 'top', type: 'danger', show: true });

    $scope.txn.busy = false;
  };

  $scope.finalize_transaction = function() {
    var txn = $scope.txn;
    txn.busy = true;

    if(!txn.coin_type.account) {
      console.error("No API key so just a demo");
      var aa = $alert({title: 'Just Playing',
        content: 'Since no API key is configured, we\'ll just pretend that worked...',
        placement: 'top', type: 'info', show: true, duration:15 });
      $scope.print_and_done();
    } else {
      var m = txn.method;
      var dest = 'voucher';
      if(m == 'email') {
        dest = txn.dest_email;
      } else if(m == 'sms') {
        dest = txn.dest_phone;
      } else if(m == 'qr') {
        dest = txn.dest_address;
      }

      // Setup a PUT to specific endpoint, with "object" of arguments... ahem.
      var newbie = Restangular.one('v1/new/send');
      newbie.amount = $scope.current_quote();
      newbie.dest = dest;
      newbie.incl_pin = (dest != 'voucher');
      newbie.account = txn.coin_type.account;

      newbie.put().then(function(r) {
        // Next step is to confirm the funds send. Might have some auditing/policy
        // check here IRL.
        var step2 = Restangular.one('v1/update/' + r.result.CK_refnum + '/auth_send');
        step2.authcode = r.result.send_authcode;

        step2.put().then(function(r2) {
          // It worked. Funds are on the way, unfortunately, we don't know the
          // p2p transaction number yet.
          txn.result = r2.result;
          console.log("Completely Done: ", txn);

          // need to get out for a bit before we print, so the DOM is
          // updated with txn.result above.
          $timeout($scope.print_and_done, 200);

        }, $scope.show_err);
      }, $scope.show_err);
    }
  };
});

app.controller('CKAuthCtrl', function($scope, $http, $log, Restangular, $rootScope)
{
  // Initial state for variables.
  $scope.auth = {
    api_key: '',
    api_secret: '',
  };

  // Try to populate keys with useful defaults... ok if this fails.
  $http({method:'GET', url:'my-keys.json'}).success(function(d, status) {
    if(status == 200) {
      // Set the keys from the file's data.
      if(d.host) {
        CK_API_HOST = d.host;
        Restangular.setBaseUrl(CK_API_HOST);
      }
      angular.extend(CK_API_KEYS, d);
      $scope.auth = d;

      $log.info("Got your keys");
    } else {
      $log.info("NOTE: You can add a JSON file in 'my-keys.json' in this directory"
        +" to pre-fill your key values.");
    }
  });
  $scope.auth_ok = false;

  $scope.$watchCollection('auth', function(newVal, oldVal) {
    if(!newVal.api_key || !newVal.api_secret) {
      // Empty API key or secret -- not an error.
      $scope.auth_ok = false;
      return;
    }

    angular.extend(CK_API_KEYS, newVal);
    $scope.auth_ok = false;

    Restangular.one('v1/my/accounts').get().then(function(d) {
      var accounts = d.results;
      console.log("Got the account list ok: " + accounts.length + ' accounts');
      $scope.auth_ok = true;
      $rootScope.$broadcast('new_account_list', accounts);
    });
  });
});


app.config(function(RestangularProvider) {

  RestangularProvider.setBaseUrl(CK_API_HOST);
  RestangularProvider.setFullRequestInterceptor(function(element, operation, route, url, headers, params, httpConfig) {

    if(route[0] != '/') {
      route = '/' + route;
    }

    console.log("Full request: ", headers, url, route);

    _.extend(headers, get_auth_headers(route));

    return {
      element: element,
      params: params,
      headers: headers,
      httpConfig: httpConfig
    };
  });

  RestangularProvider.addResponseInterceptor(function(data, operation, what, url, response, deferred) {
    if(response.status != 200) {
      console.error("CK Request failed: " + response.status);
      console.error("JSON contents: ", data);
    }
    return data;
  });

  RestangularProvider.setErrorInterceptor(function(response, deferred, responseHandler) {
    if(response.status != 200) {
      console.log("API ERROR", response);
    }
    return true; // error not handled
  });
});


function get_auth_headers(endpoint) {
  if(!CK_API_KEYS.api_secret || !CK_API_KEYS.api_key) {
    console.warn("No API key/secret defined but continuing w/o authorization headers.")
    return {};
  }

  return CK_API.auth_headers(CK_API_KEYS.api_key, CK_API_KEYS.api_secret, endpoint);
}