import { Component, ChangeDetectorRef, AfterViewInit, HostListener, ViewChild, ElementRef, Input } from '@angular/core';
import { environment } from '../../../environments/environment';


import { SetState } from 'src/app/state.decorator';
import { PaymentService } from '../payment.service';
import { tap } from 'rxjs/operators';
import { stripeStyle } from '../stripe-defaults';
import { NotificationService } from 'src/app/notification/notification.service';
import { FormGroup } from '@angular/forms';
import * as firebase from 'firebase/app';


// Global Script Namespaces
declare var Stripe;
declare var paypal;

@Component({
  templateUrl: './payment-form.component.html'
})
export class PaymentFormComponent implements AfterViewInit {

  @Input() action = 'purchase';
  @Input() allowCoupons;

  // Global product selection
  product;

  // Stripe Elements
  stripe: any;
  elements: any;
  card: any;
  prButton: any;
  pr: any;

  // UI State
  serverError;
  formState;
  loadingState;
  success;

  // Coupon State
  couponResult;
  couponError;
  couponLoading: boolean;


  @ViewChild('cardElement') cardElement: ElementRef;
  @ViewChild('prElement') prElement: ElementRef;
  @ViewChild('paypalElement') paypalElement: ElementRef;

  // FormGroup Require or angular with throw errors
  fg;

  analytics = firebase.analytics();

  constructor(private cd: ChangeDetectorRef, public pmt: PaymentService, public ns: NotificationService) {
    this.pmt.product.pipe(
      tap(v => {
        this.setState('product', v);
        this.paypalInit();
      })
    )
    .subscribe();
    this.fg = new FormGroup({});
  }

  ngAfterViewInit() {
    this.setup();
  }

  setup() {
    this.stripe = Stripe(environment.stripe);
    this.elements = this.stripe.elements(
      {
        fonts: [{
          cssSrc: 'https://use.typekit.net/rcr1opg.css'
        }]
      }
    );

    // Create an instance of the card Element.
    this.card = this.elements.create('card', { style: stripeStyle, iconStyle: 'solid' });
    this.card.mount(this.cardElement.nativeElement);

    this.listenToFormState();

  }

  // PAYPAL INTEGRATION
  paypalInit() {
    this.paypalElement.nativeElement.innerHTML = '';
    const valid = this.product.type === 'order';
    if (valid) {
      paypal.Buttons({
        createOrder: (data, actions) => {

          if (this.total < 20000 && this.product.id === 'proLifetime') {
            return this.setState('serverError', 'Coupon exceeds max discount on Lifetime access, try a different coupon ');
          }

          return actions.order.create({
            purchase_units: [{
              description: this.product.description,
              reference_id: this.product.sku,
              amount: {
                currency_code: 'USD',
                value: this.paypalTotal,
              }
            }]
          });
        },
        onApprove: async (data, actions) => {
          this.setState('loadingState', 'processing payment...');
          const order = await actions.order.capture();

          this.setState('loadingState', 'success, setting up PRO access...');

          const { res, serverError } = await this.pmt.paypalHandler(order);

          if (serverError) {
            this.setState('serverError', serverError.message);
            this.setState('loadingState', null);
          } else {
            this.onSuccess();
          }

        },
        onError: (err) => {
          console.log(err);
          this.setState('serverError', 'Unable to process PayPal payment');
        }
      }).render(this.paypalElement.nativeElement);
    }
    this.cd.detectChanges();
  }

  listenToFormState() {
    this.card.addEventListener('change', (event) => {
      this.setState('formState', event);
    });
  }

  async handleForm(e) {
    e.preventDefault();
    this.setState('serverError', null);
    this.setState('loadingState', 'validating card...');
    const { source, error } = await this.stripe.createSource(this.card);

    if (error) {
      this.setState('loadingState', null);
      this.setState('serverError', `Unsuccessful ${error}`);
    }

    this.setState('loadingState', 'processing...');

    const { res, serverError } = await this.sourceHandler(source);

    if (serverError) {
      this.setState('serverError', serverError.message);
      this.setState('loadingState', null);
    } else {
      this.onSuccess();
    }
  }

  async sourceHandler(source) {
    const couponId = this.couponResult && this.couponResult.id;

    switch (this.action) {
      case 'purchase':
        if (this.product.type === 'subscribe') {
          return this.pmt.createSubscription(source, this.product.planId, couponId);
        }

        if (this.product.type === 'order') {
          return this.pmt.createOrder(source, this.product.sku, couponId);
        }
        break;


      case 'source':
        return this.pmt.setSource(source);
    }
  }

  onSuccess() {
    this.card.clear();
    this.pmt.product.next(null);
    this.ns.setNotification({ title: 'Success!', text: 'Thank you :)' });
    this.setState('loadingState', null);
    this.setState('success', true);
    this.analytics.logEvent('pro_upgrade', { value: this.action, product: this.product && this.product.id });
  }

  get total() {
    return this.pmt.calcTotal(this.product.price, this.couponResult);
  }

  get paypalTotal() {
    return (this.total / 100).toFixed(2);
  }

  async applyCoupon(e, val) {
    e.preventDefault();
    this.couponResult = null;
    this.couponError = null;
    this.serverError = null;
    this.couponLoading = true;
    this.cd.detectChanges();

    const { res, serverError } = await this.pmt.getCoupon(val);

    if (res && res.valid) {
      this.couponResult = res;
    } else {
      this.couponError = true;
    }
    this.couponLoading = false;
    this.cd.detectChanges();
  }

  @HostListener('document:DOMContentLoaded')
  domContentLoaded() {
    if (!this.stripe) {
      this.setup();
    }
  }

  @SetState()
  setState(k, v) {
    this[k] = v;
  }

}
